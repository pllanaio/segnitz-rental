import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup_restore', Path(__file__).parent.parent / 'scripts/ops/backup_restore.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class BackupRestoreSafety(unittest.TestCase):
    def test_new_probe_database_names_only(self):
        self.assertEqual(ops.db_name('segnitz_restore_test_20260913', probe=True), 'segnitz_restore_test_20260913')
        for name in ['segnitz_rental', 'segnitz_test', 'mysql', 'test;DROP DATABASE x', '../segnitz_restore_test_1']:
            with self.assertRaises(ValueError):
                ops.db_name(name, probe=True)

    def test_inventory_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'private').write_text('synthetic fixture')
            (root / 'link').symlink_to(root / 'private')
            with self.assertRaises(ValueError):
                ops.inventory(root)

    def test_credentials_require_private_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / 'client.cnf'
            file.write_text('[client]\nuser=synthetic\n')
            file.chmod(0o644)
            with self.assertRaises(ValueError):
                ops.private_file(file)
            file.chmod(0o600)
            self.assertEqual(ops.private_file(file), file)

    def test_archive_rejects_traversal_links_and_duplicate_entries_before_extraction(self):
        for kind in ['traversal', 'symlink', 'duplicate']:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                archive = root / 'archive.tar'
                with tarfile.open(archive, 'w') as tar:
                    entry = tarfile.TarInfo('../outside' if kind == 'traversal' else 'database.sql')
                    if kind == 'symlink':
                        entry.type, entry.linkname = tarfile.SYMTYPE, '/etc/passwd'
                    tar.addfile(entry)
                    if kind == 'duplicate':
                        tar.addfile(entry)
                target = root / 'target'
                target.mkdir()
                with self.assertRaises(ValueError):
                    ops.unpack_checked(archive, target)
                self.assertEqual(list(target.iterdir()), [])

    def test_archive_roundtrip_verifies_database_and_both_volume_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            source.mkdir()
            for volume in ['products', 'returns']:
                (source / volume).mkdir()
                (source / volume / 'fixture.png').write_bytes(b'synthetic-image-fixture')
            (source / 'database.sql').write_text('-- isolated synthetic SQL only\n')
            manifest = {'schema': 1, 'databaseSha256': ops.file_hash(source / 'database.sql'),
                        'files': {volume: ops.inventory(source / volume) for volume in ['products', 'returns']}}
            (source / 'manifest.json').write_text(json.dumps(manifest))
            for corrupt in [False, True]:
                archive = root / f'archive-{corrupt}.tar'
                if corrupt:
                    (source / 'returns' / 'fixture.png').write_bytes(b'changed-after-backup')
                with tarfile.open(archive, 'w') as tar:
                    for entry in source.iterdir():
                        tar.add(entry, arcname=entry.name)
                target = root / f'target-{corrupt}'
                target.mkdir()
                if corrupt:
                    with self.assertRaises(ValueError):
                        ops.unpack_checked(archive, target)
                else:
                    self.assertEqual(ops.unpack_checked(archive, target), manifest)


if __name__ == '__main__':
    unittest.main()
