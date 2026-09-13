"""Ephemeral TLS fixtures for the owned, provider-isolated restore rehearsal."""
import os
from pathlib import Path
import subprocess


def openssl(arguments):
    result = subprocess.run(['openssl', *map(str, arguments)], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=30, check=False)
    if result.returncode:
        raise RuntimeError('Ephemeral TLS fixture generation failed')


def create_certificates(directory):
    directory = Path(directory)
    directory.mkdir(mode=0o700)
    previous_umask = os.umask(0o077)
    try:
        for name in ['ca', 'untrusted-ca']:
            openssl(['req', '-x509', '-newkey', 'rsa:2048', '-noenc', '-sha256', '-days', '2',
                     '-subj', f'/CN=Segnitz isolated {name}', '-keyout', directory / f'{name}-key.pem',
                     '-out', directory / f'{name}.pem', '-addext', 'basicConstraints=critical,CA:TRUE',
                     '-addext', 'keyUsage=critical,keyCertSign,cRLSign'])
        openssl(['req', '-new', '-newkey', 'rsa:2048', '-noenc', '-sha256', '-subj', '/CN=restore-mysql',
                 '-keyout', directory / 'server-key.pem', '-out', directory / 'server.csr'])
        extensions = directory / 'server.ext'
        extensions.write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n'
                              'extendedKeyUsage=serverAuth\nsubjectAltName=DNS:restore-mysql,DNS:localhost,IP:127.0.0.1\n')
        openssl(['x509', '-req', '-in', directory / 'server.csr', '-CA', directory / 'ca.pem',
                 '-CAkey', directory / 'ca-key.pem', '-CAcreateserial', '-days', '2', '-sha256',
                 '-extfile', extensions, '-out', directory / 'server-cert.pem'])
        # Only public CA certificates are readable by the app's unprivileged
        # node user. Private CA/server keys stay 0600 in the owned 0700 directory.
        for name in ['ca.pem', 'untrusted-ca.pem']:
            (directory / name).chmod(0o644)
    finally:
        os.umask(previous_umask)
    return directory


# Copy only the required public CA/server certificate and private server key
# into the newly owned container. Host fixture ownership never changes.
MYSQL_TLS_ENTRYPOINT = '''set -eu
mkdir -m 0700 /run/segnitz-rehearsal-tls
cp /rehearsal-tls/ca.pem /rehearsal-tls/server-cert.pem /rehearsal-tls/server-key.pem /run/segnitz-rehearsal-tls/
chown -R mysql:mysql /run/segnitz-rehearsal-tls
chmod 0600 /run/segnitz-rehearsal-tls/*
exec /usr/local/bin/docker-entrypoint.sh mysqld --require-secure-transport=ON --ssl-ca=/run/segnitz-rehearsal-tls/ca.pem --ssl-cert=/run/segnitz-rehearsal-tls/server-cert.pem --ssl-key=/run/segnitz-rehearsal-tls/server-key.pem
'''
