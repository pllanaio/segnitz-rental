#!/usr/bin/env python3
"""Rehearse encrypted backup and restore using ONLY newly created synthetic resources.

Requires Docker, Python 3.12+, MySQL 8 mysql/mysqldump, age and age-keygen.
Runs an existing immutable candidate image on an internal network without provider
credentials. Never accepts an existing DB, volume, container or Compose project.
"""
import argparse
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

import backup_restore
from rehearsal_workspace import SyntheticWorkspace
from rehearse_restore_tls import create_certificates, MYSQL_TLS_ENTRYPOINT

MYSQL_IMAGE = 'mysql:8.4.11@sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb'


def command(args, timeout=180, **kwargs):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, check=False, **kwargs)
    if result.returncode:
        # No container logs, SQL, environment, credentials or HTTP bodies escape.
        raise RuntimeError(f'{Path(args[0]).name} failed with exit {result.returncode}')
    return result.stdout.decode()


def private_text(path, value):
    with open(path, 'x', opener=lambda name, flags: os.open(name, flags, 0o600)) as stream:
        stream.write(value)


def environment_file(path, values):
    if any('\n' in str(value) or '\r' in str(value) for value in values.values()):
        raise ValueError('Invalid environment value')
    private_text(path, ''.join(f'{key}={value}\n' for key, value in values.items()))


class Client:
    def __init__(self, port):
        self.origin = f'http://127.0.0.1:{port}'
        self.client = urllib.request.build_opener(urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, route, data=None, csrf=None):
        headers = {'Content-Type': 'application/json'} if data is not None else {}
        if csrf:
            headers['X-CSRF-Token'] = csrf
        request = urllib.request.Request(self.origin + route,
            data=json.dumps(data).encode() if data is not None else None, headers=headers)
        try:
            response = self.client.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read(2 * 1024 * 1024 + 1)
            if len(body) > 2 * 1024 * 1024:
                raise ValueError('Unexpected HTTP response size')
            return response.status, body

    def login(self, name, password):
        status, body = self.request('/csrf-token')
        if status != 200:
            raise ValueError('CSRF smoke failed')
        status, _ = self.request('/login', {'username': f'{name}@restore.invalid', 'password': password}, json.loads(body)['csrfToken'])
        if status != 200:
            raise ValueError('Login smoke failed')


def smoke(port, password):
    owner, admin, foreign = Client(port), Client(port), Client(port)
    for client, name in [(owner, 'owner'), (admin, 'admin'), (foreign, 'foreign')]:
        client.login(name, password)
    status, body = owner.request('/my-orders/1')
    if status != 200:
        raise ValueError('Restored owner order unavailable')
    order = json.loads(body)
    finance = order['financialSummary']
    expected = {'receivedCents': 25000, 'refundedCents': 15000, 'customerDueCents': 0, 'refundDueCents': 0}
    if order['status'] != 'returned' or any(finance.get(key) != value for key, value in expected.items()):
        raise ValueError('Restored ledger/order smoke mismatch')
    status, body = admin.request('/admin/orders/1')
    if status != 200 or json.loads(body)['financialSummary'] != finance:
        raise ValueError('Restored admin/customer financial summaries disagree')
    status, image = owner.request('/img/returns/restore-fixture.png')
    if status != 200 or not image.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Restored private photo unavailable')
    if foreign.request('/my-orders/1')[0] != 404 or foreign.request('/img/returns/restore-fixture.png')[0] != 404:
        raise ValueError('Restored ownership boundary failed')
    if Client(port).request('/img/returns/restore-fixture.png')[0] != 404:
        raise ValueError('Restored anonymous image boundary failed')
    if owner.request('/ready')[0] != 200 or Client(port).request('/ready')[0] != 200:
        raise ValueError('Readiness with/without session failed')
    return {'ownerOrder': True, 'privateReturnImage': True, 'foreignAndAnonymousDenied': True,
            'customerAdminFinanceEqual': True, 'readinessWithAndWithoutSession': True,
            'returnImageSha256': hashlib.sha256(image).hexdigest()}


def run_rehearsal(args):
    for executable in ['docker', 'mysql', 'mysqldump', 'age', 'age-keygen', 'openssl']:
        if not shutil.which(executable):
            raise ValueError('Rehearsal prerequisite missing')
    if sys.version_info < (3, 12):
        raise ValueError('Python 3.12 or newer required')
    if not re.fullmatch(r'[a-f0-9]{40}', args.expected_revision):
        raise ValueError('Full expected source revision required')
    image = json.loads(command(['docker', 'image', 'inspect', args.image]))[0]
    image_id = image['Id']
    labels = image.get('Config', {}).get('Labels') or {}
    if labels.get('org.opencontainers.image.revision') != args.expected_revision:
        raise ValueError('Candidate image source revision mismatch')
    script_revision = command(['git', '-C', str(Path(__file__).resolve().parents[2]), 'rev-parse', 'HEAD']).strip()
    if script_revision != args.expected_revision:
        raise ValueError('Rehearsal scripts and candidate source differ')
    command(['docker', 'pull', MYSQL_IMAGE], timeout=300)
    suffix = secrets.token_hex(6)
    project = f'segnitz-restore-test-{suffix}'
    source_db, target_db = f'segnitz_restore_test_source_{suffix}', f'segnitz_restore_test_target_{suffix}'
    evidence = {'schema': 1, 'syntheticDataOnly': True, 'imageId': image_id,
                'imageRepoDigests': image.get('RepoDigests') or [], 'sourceRevision': script_revision,
                'mysqlImage': MYSQL_IMAGE, 'applicationSmokeVerified': False}
    containers = []
    network = None
    stage = 'start'
    started = time.monotonic()
    workspace = SyntheticWorkspace(image_id, command, containers, args.temp_directory)
    try:
        with workspace as temporary:
            root = Path(temporary)
            source_products, source_returns = root / 'source-products', root / 'source-returns'
            source_products.mkdir()
            source_returns.mkdir()
            password = secrets.token_urlsafe(36)
            fixture_password = secrets.token_urlsafe(36)
            certificates = create_certificates(root / 'tls')
            ca_mount = f'type=bind,src={certificates / "ca.pem"},dst=/run/rehearsal-ca.pem,readonly'
            environment_file(root / 'mysql.env', {'MYSQL_ROOT_PASSWORD': password, 'MYSQL_ROOT_HOST': '%'})
            network = command(['docker', 'network', 'create', '--internal', project]).strip()
            internal = command(['docker', 'network', 'inspect', '--format', '{{.Internal}}', network]).strip()
            if internal != 'true':
                raise ValueError('Provider network isolation failed')
            evidence['providerNetworkInternal'] = True
            db_container = command(['docker', 'run', '-d', '--network', network, '--network-alias', 'restore-mysql',
                '--network-alias', 'restore-mysql-wrong-host', '--entrypoint', 'sh',
                '--mount', f'type=bind,src={certificates / "ca.pem"},dst=/rehearsal-tls/ca.pem,readonly',
                '--mount', f'type=bind,src={certificates / "server-cert.pem"},dst=/rehearsal-tls/server-cert.pem,readonly',
                '--mount', f'type=bind,src={certificates / "server-key.pem"},dst=/rehearsal-tls/server-key.pem,readonly',
                '--env-file', str(root / 'mysql.env'), '-p', '127.0.0.1::3306', '--memory=1g', '--cpus=2',
                MYSQL_IMAGE, '-c', MYSQL_TLS_ENTRYPOINT]).strip()
            containers.append(db_container)
            port = json.loads(command(['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', db_container]))['3306/tcp'][0]['HostPort']
            config = root / 'client.cnf'
            private_text(config, f'[client]\nuser=root\npassword={password}\nhost=127.0.0.1\nport={port}\nprotocol=TCP\n'
                         f'ssl-mode=VERIFY_IDENTITY\nssl-ca={certificates / "ca.pem"}\n')
            mysql = ['mysql', f'--defaults-extra-file={config}', '--batch', '--skip-column-names', '--local-infile=0']
            stage = 'database-ready'
            deadline = time.monotonic() + 120
            while True:
                try:
                    command([*mysql, '--execute', 'SELECT 1'], timeout=5)
                    break
                except (RuntimeError, subprocess.TimeoutExpired):
                    if time.monotonic() > deadline:
                        raise ValueError('Synthetic MySQL startup deadline exceeded') from None
                    time.sleep(1)
            env = {'NODE_ENV': 'test', 'DB_HOST': 'restore-mysql', 'DB_USER': 'root', 'DB_PW': password,
                   'DB_TLS': '1', 'DB_TLS_CA_FILE': '/run/rehearsal-ca.pem',
                   'DB_PORT': '3306', 'SESSION_SECRET': secrets.token_urlsafe(36),
                   'ADMIN_SETUP_TOKEN': secrets.token_urlsafe(36), 'BASE_URL': 'http://127.0.0.1:3000',
                   'PORT': '3000', 'MOLLIE_TEST_MODE': '1', 'DISABLE_EMAILS': '1',
                   'MAIL_DELIVERY_PAUSED': '1', 'DISABLE_PERIODIC_CLEANUP': '1',
                   'DISABLE_PAYMENT_RECONCILIATION': '1', 'RESTORE_SYNTHETIC_REHEARSAL': '1',
                   'RESTORE_FIXTURE_PASSWORD': fixture_password, 'BUSINESS_TIME_ZONE': 'Europe/Berlin'}
            script_mount = f'type=bind,src={Path(__file__).resolve().parent},dst=/app/scripts/ops,readonly'

            def start_app(database, products, returns, fixture=False):
                workspace.register_mount(products)
                workspace.register_mount(returns)
                env_path = root / ('source.env' if fixture else 'target.env')
                environment_file(env_path, {**env, 'DB_NAME': database})
                command_args = ['docker', 'run', '-d', '--network', network, '--env-file', str(env_path),
                    '-p', '127.0.0.1::3000', '--memory=768m', '--cpus=2',
                    '--label', f'com.docker.compose.project={project}', '--label', 'com.docker.compose.service=app',
                    '--mount', ca_mount,
                    '--mount', script_mount,
                    '--mount', f'type=bind,src={products},dst=/app/public/img/products',
                    '--mount', f'type=bind,src={returns},dst=/app/uploads/returns', image_id]
                if fixture:
                    command_args.extend(['node', 'scripts/ops/restore-rehearsal-fixture.js'])
                container = command(command_args).strip()
                containers.append(container)
                app_port = json.loads(command(['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', container]))['3000/tcp'][0]['HostPort']
                deadline = time.monotonic() + 120
                while True:
                    try:
                        if Client(app_port).request('/ready')[0] == 200:
                            return container, app_port
                    except (OSError, urllib.error.URLError):
                        pass
                    if time.monotonic() > deadline:
                        raise ValueError('Synthetic application startup deadline exceeded')
                    if command(['docker', 'inspect', '--format', '{{.State.Running}}', container]).strip() != 'true':
                        raise ValueError('Synthetic application stopped before readiness')
                    time.sleep(1)

            stage = 'source-smoke'
            source_container, app_port = start_app(source_db, source_products, source_returns, fixture=True)
            source_smoke = smoke(app_port, fixture_password)
            stage = 'verified-database-tls'
            tls_results = []
            for mode in ['trusted', 'untrusted-ca', 'wrong-hostname', 'trusted']:
                tls_env = root / f'tls-{len(tls_results)}.env'
                environment_file(tls_env, {**env, 'DB_NAME': source_db,
                    'DB_HOST': 'restore-mysql-wrong-host' if mode == 'wrong-hostname' else 'restore-mysql'})
                certificate = certificates / ('untrusted-ca.pem' if mode == 'untrusted-ca' else 'ca.pem')
                result = command(['docker', 'run', '--rm', '--network', network,
                    '--env-file', str(tls_env), '--entrypoint', 'node', '--memory=256m', '--cpus=1',
                    '--mount', script_mount,
                    '--mount', f'type=bind,src={certificate},dst=/run/rehearsal-ca.pem,readonly',
                    image_id, 'scripts/ops/verify-database-tls.js', mode])
                tls_results.append(json.loads(result))
            evidence['databaseTlsAcceptance'] = tls_results
            command(['docker', 'stop', '--time', '30', source_container], timeout=40)
            if command(['docker', 'inspect', '--format', '{{.State.ExitCode}}', source_container]).strip() != '0':
                raise ValueError('Source writer did not drain cleanly')
            # Entrypoint chown preserves mode0700 while switching to container
            # nodeUID. Return these stopped synthetic mounts to the host before
            # the host-side encrypted backup inventories/copies their contents.
            workspace.restore_ownership([source_products, source_returns])
            evidence['sourceImageOwnershipReturnedToHost'] = True
            stage = 'encrypted-backup'
            identity, recipients = root / 'identity', root / 'recipients'
            command(['age-keygen', '-o', str(identity)])
            identity.chmod(0o600)
            private_text(recipients, command(['age-keygen', '-y', str(identity)]))
            archive = root / 'synthetic.age'
            # The existing helper independently inspects the genuine stopped
            # writer containers before AND after the dump/volume copy.
            helper = str(Path(__file__).with_name('backup_restore.py'))
            command([sys.executable, helper, 'backup', '--client-config', str(config), '--database', source_db,
                '--temp-directory', temporary, '--products', str(source_products), '--returns', str(source_returns),
                '--compose-project', project, '--recipients', str(recipients), '--output', str(archive)])
            evidence['sourceWriterDrained'] = True
            evidence['encryptedSha256'] = backup_restore.file_hash(archive)
            stage = 'restore-new-target'
            destination = root / 'restored'
            command([sys.executable, helper, 'restore-probe', '--client-config', str(config), '--database', target_db,
                '--temp-directory', temporary, '--backup', str(archive), '--expected-sha256', evidence['encryptedSha256'],
                '--identity', str(identity), '--destination', str(destination), '--port', str(port)])
            stage = 'decode-schema-ledger'
            verifier_env = root / 'verifier.env'
            environment_file(verifier_env, {**env, 'DB_NAME': target_db, 'DB_HOST': 'localhost'})
            raw = command(['docker', 'run', '--rm', '--network', f'container:{db_container}',
                '--env-file', str(verifier_env), '--entrypoint', 'node', '--memory=768m', '--cpus=2',
                '--mount', ca_mount,
                '--mount', script_mount,
                '--mount', f'type=bind,src={destination / "products"},dst=/probe/products,readonly',
                '--mount', f'type=bind,src={destination / "returns"},dst=/probe/returns,readonly',
                image_id, '--dns-result-order=ipv4first', 'scripts/ops/verify-restore.js', '/probe/products', '/probe/returns'])
            verification = json.loads(raw)
            if verification['referencedImagesChecked'] != 2 or verification['signatureCount'] != 1:
                raise ValueError('Restored fixture inventory mismatch')
            evidence['offlineVerification'] = verification
            stage = 'restored-application-smoke'
            _, restored_port = start_app(target_db, destination / 'products', destination / 'returns')
            evidence['applicationSmoke'] = smoke(restored_port, fixture_password)
            if evidence['applicationSmoke']['returnImageSha256'] != source_smoke['returnImageSha256']:
                raise ValueError('Application served different restored private image')
            # Pause must preserve the queued message; no false delivery receipt.
            outbox = command([*mysql, target_db, '--execute', "SELECT status, attempt_count, completed_at IS NULL FROM external_effects_outbox WHERE operation_key='restore-fixture-mail'"])
            if outbox.strip() != 'pending\t0\t1':
                raise ValueError('Restored paused outbox was consumed')
            evidence.update({'applicationSmokeVerified': True, 'pausedOutboxPreserved': True,
                'providersContacted': False, 'restoreVerified': True, 'elapsedSeconds': round(time.monotonic() - started, 2)})
        evidence['syntheticWritersAndFilesCleaned'] = True
        print(json.dumps({'event': 'restore.rehearsal.passed', 'elapsedSeconds': evidence['elapsedSeconds']}))
    except BaseException:
        evidence.update({'failedStage': stage, 'restoreVerified': False, 'elapsedSeconds': round(time.monotonic() - started, 2)})
        raise
    finally:
        # Workspace exit stops every created writer and restores host ownership
        # before deleting synthetic files, including during failed smoke tests.
        if network:
            subprocess.run(['docker', 'network', 'rm', network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        private_text(args.evidence, json.dumps(evidence, indent=2) + '\n')


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True, help='Already built candidate; immutable local image ID is resolved before use')
    parser.add_argument('--expected-revision', required=True, help='Full source SHA, also required on image OCI revision label')
    parser.add_argument('--evidence', required=True, help='New JSON evidence file, never secrets or raw logs')
    parser.add_argument('--temp-directory', default='/dev/shm', help='Scratch for exclusively synthetic fixtures, default tmpfs')
    args = parser.parse_args()
    if Path(args.evidence).exists():
        parser.error('Evidence file must not already exist')
    try:
        run_rehearsal(args)
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired, KeyError) as error:
        parser.exit(1, f'Restore rehearsal stopped: {type(error).__name__}. No production resource was addressed.\n')


if __name__ == '__main__':
    main()
