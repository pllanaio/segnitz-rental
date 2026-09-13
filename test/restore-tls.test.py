import importlib.util
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('rehearse_restore_tls', Path(__file__).resolve().parents[1] / 'scripts/ops/rehearse_restore_tls.py')
tls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tls)


class EphemeralTlsFixture(unittest.TestCase):
    def test_real_chain_identities_private_keys_and_negative_verification(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = tls.create_certificates(Path(temporary) / 'certificates')
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
            for name in ['ca-key.pem', 'untrusted-ca-key.pem', 'server-key.pem']:
                self.assertEqual(stat.S_IMODE((directory / name).stat().st_mode), 0o600)
            def verify(ca, *arguments):
                return subprocess.run(['openssl', 'verify', '-CAfile', str(directory / ca),
                    *arguments, str(directory / 'server-cert.pem')], stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, timeout=10, check=False).returncode
            self.assertEqual(verify('ca.pem', '-verify_hostname', 'restore-mysql'), 0)
            self.assertEqual(verify('ca.pem', '-verify_hostname', 'localhost'), 0)
            self.assertEqual(verify('ca.pem', '-verify_ip', '127.0.0.1'), 0)
            self.assertNotEqual(verify('untrusted-ca.pem', '-verify_hostname', 'restore-mysql'), 0)
            self.assertNotEqual(verify('ca.pem', '-verify_hostname', 'restore-mysql-wrong-host'), 0)
            with self.assertRaises(FileExistsError):
                tls.create_certificates(directory)


if __name__ == '__main__':
    unittest.main()
