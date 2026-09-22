#!/usr/bin/env python3
"""Offline, encrypted MySQL + upload backup; restore only to new local probe resources.

No production resources are stopped, deleted, migrated or restored by this helper.
Requires Python 3.12+, MySQL 8 clients, age and (backup only) Docker CLI.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile


def run(args, **kwargs):
    # Never inherit CLI stderr: database clients may echo SQL or credentials.
    result = subprocess.run(args, stderr=subprocess.PIPE, check=False, timeout=3600, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed (exit {result.returncode}); inspect restricted operator diagnostics')
    return result


def private_file(filename):
    path = Path(filename).resolve(strict=True)
    if not path.is_file() or path.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise ValueError('Credential/key files must exist with owner-only permissions (0600)')
    return path


def db_name(value, probe=False):
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', value):
        raise ValueError('Unsafe database name')
    if probe and not re.fullmatch(r'segnitz_restore_(test|probe)_[A-Za-z0-9_]+', value):
        raise ValueError('Restore requires a new segnitz_restore_test_* or segnitz_restore_probe_* database')
    return value


def file_hash(filename):
    digest = hashlib.sha256()
    with open(filename, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def inventory(directory):
    root = Path(directory).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Expected image directory')
    files = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError('Symlinks and special files are not supported in upload volumes')
        if path.is_file():
            files[path.relative_to(root).as_posix()] = {'bytes': path.stat().st_size, 'sha256': file_hash(path)}
    return files


def stopped_app(project):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', project):
        raise ValueError('Unsafe Compose project')
    ids = run(['docker', 'ps', '-aq', '--filter', f'label=com.docker.compose.project={project}',
               '--filter', 'label=com.docker.compose.service=app'], stdout=subprocess.PIPE).stdout.decode().split()
    if not ids:
        raise ValueError('No stopped application container found; cannot verify maintenance state')
    raw = run(['docker', 'inspect', '--format', '{{json .State}}', *ids], stdout=subprocess.PIPE).stdout.decode()
    states = [json.loads(line) for line in raw.splitlines() if line.strip()]
    if any(state.get('Running') or state.get('Restarting') for state in states):
        raise ValueError('Drain and stop every app container before a consistent backup')
    return ids


def backup(args):
    output = Path(args.output).absolute()
    if output.suffix != '.age' or output.exists():
        raise ValueError('Backup output must be a new .age file')
    config = private_file(args.client_config)
    name = db_name(args.database)
    recipient = Path(args.recipients).resolve(strict=True)
    if not recipient.is_file():
        raise ValueError('age recipient file required')
    app_ids = stopped_app(args.compose_project)
    products, returns = Path(args.products).resolve(strict=True), Path(args.returns).resolve(strict=True)
    before = {'products': inventory(products), 'returns': inventory(returns)}
    # Caller selects an encrypted temporary filesystem. No plaintext backup is retained.
    with tempfile.TemporaryDirectory(prefix='segnitz-backup-', dir=args.temp_directory) as temporary:
        root = Path(temporary)
        with (root / 'database.sql').open('xb') as stream:
            run(['mysqldump', f'--defaults-extra-file={config}', '--single-transaction', '--quick',
                 '--no-tablespaces', '--set-gtid-purged=OFF', '--hex-blob', '--skip-events', '--skip-routines',
                 '--default-character-set=utf8mb4', name], stdout=stream)
        shutil.copytree(products, root / 'products')
        shutil.copytree(returns, root / 'returns')
        after = {'products': inventory(products), 'returns': inventory(returns)}
        copied = {'products': inventory(root / 'products'), 'returns': inventory(root / 'returns')}
        if before != after or before != copied:
            raise ValueError('Upload volumes changed during backup; discard candidate and drain all writers')
        stopped_app(args.compose_project)
        manifest = {'schema': 1, 'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                    'database': name, 'databaseSha256': file_hash(root / 'database.sql'),
                    'files': before, 'writerContainersStopped': app_ids,
                    'consistency': 'application stopped; transactional dump and unchanged upload inventories'}
        (root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        archive = root / 'backup.tar'
        with tarfile.open(archive, 'w') as tar:
            for entry in ['database.sql', 'manifest.json', 'products', 'returns']:
                tar.add(root / entry, arcname=entry, recursive=True)
        # age refuses overwrite; reserve output through exclusive creation too.
        with output.open('xb') as stream:
            try:
                run(['age', '--encrypt', '--recipients-file', str(recipient), str(archive)], stdout=stream)
            except BaseException:
                output.unlink(missing_ok=True)
                raise
    evidence = {'schema': 1, 'completedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'encryptedSha256': file_hash(output), 'restoreVerified': False}
    with Path(str(output) + '.json').open('x') as stream:
        stream.write(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence))


def unpack_checked(archive, root):
    with tarfile.open(archive, 'r:') as tar:
        members = tar.getmembers()
        names = set()
        for member in members:
            path = Path(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in {'database.sql', 'manifest.json', 'products', 'returns'}:
                raise ValueError('Unsafe backup path')
            if not (member.isdir() or member.isfile()) or member.name in names:
                raise ValueError('Links, special files and duplicate paths are forbidden')
            names.add(member.name)
        tar.extractall(root, members=members, filter='data')
    manifest = json.loads((root / 'manifest.json').read_text())
    if manifest.get('schema') != 1 or file_hash(root / 'database.sql') != manifest.get('databaseSha256'):
        raise ValueError('Backup database checksum mismatch')
    actual = {'products': inventory(root / 'products'), 'returns': inventory(root / 'returns')}
    if actual != manifest.get('files'):
        raise ValueError('Backup upload checksum mismatch')
    return manifest


def restore(args):
    if not re.fullmatch(r'[a-f0-9]{64}', args.expected_sha256 or '') or file_hash(args.backup) != args.expected_sha256:
        raise ValueError('Encrypted backup does not match the independently trusted backup catalog')
    name = db_name(args.database, probe=True)
    config = private_file(args.client_config)
    identity = private_file(args.identity)
    destination = Path(args.destination).absolute()
    if destination.exists():
        raise ValueError('Restore destination must not exist')
    # Override config-file hosts and database: restores cannot address a remote server.
    mysql = ['mysql', f'--defaults-extra-file={config}', '--protocol=TCP', '--host=127.0.0.1',
             f'--port={args.port}', '--default-character-set=utf8mb4', '--batch', '--skip-column-names', '--binary-mode', '--local-infile=0']
    with tempfile.TemporaryDirectory(prefix='segnitz-restore-', dir=args.temp_directory) as temporary:
        root = Path(temporary)
        with (root / 'backup.tar').open('xb') as stream:
            run(['age', '--decrypt', '--identity', str(identity), args.backup], stdout=stream)
        checked = root / 'checked'
        checked.mkdir()
        manifest = unpack_checked(root / 'backup.tar', checked)
        # Atomic CREATE without IF NOT EXISTS rejects every existing database.
        run([*mysql, '--execute', f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'], stdout=subprocess.PIPE)
        try:
            destination.mkdir(mode=0o700)
            with (checked / 'database.sql').open('rb') as stream:
                run([*mysql, name], stdin=stream, stdout=subprocess.PIPE)
            shutil.copytree(checked / 'products', destination / 'products')
            shutil.copytree(checked / 'returns', destination / 'returns')
        except BaseException as error:
            raise RuntimeError('Restore incomplete: retain isolated target for diagnosis; no automatic DROP or reset was performed') from error
    evidence = {'schema': 1, 'restoredAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'sourceCreatedAt': manifest['createdAt'],
                'database': name, 'fileChecksumsVerified': True, 'applicationSmokeVerified': False,
                'providerIsolationRequiredBeforeAppStart': True}
    (destination / 'restore-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ['backup', 'restore-probe']:
        command = commands.add_parser(name)
        command.add_argument('--client-config', required=True, help='Owner-only MySQL client option file; no credentials on CLI')
        command.add_argument('--database', required=True)
        command.add_argument('--temp-directory', required=True, help='Operator-provided encrypted scratch filesystem')
        if name == 'backup':
            command.add_argument('--products', required=True)
            command.add_argument('--returns', required=True)
            command.add_argument('--compose-project', required=True)
            command.add_argument('--recipients', required=True)
            command.add_argument('--output', required=True)
        else:
            command.add_argument('--backup', required=True)
            command.add_argument('--expected-sha256', required=True, help='Encrypted archive hash from independently trusted backup catalog')
            command.add_argument('--identity', required=True)
            command.add_argument('--destination', required=True)
            command.add_argument('--port', type=int, default=3306)
    args = parser.parse_args()
    try:
        backup(args) if args.command == 'backup' else restore(args)
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f'Operation stopped: {type(error).__name__}. See documented prerequisites; no automatic reset.\n')


if __name__ == '__main__':
    main()
