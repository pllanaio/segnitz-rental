import os
import errno
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'ops'))
from rehearsal_workspace import SyntheticWorkspace, OWNERSHIP_SCRIPT
from backup_restore import inventory

IMAGE_ID = 'sha256:' + 'a' * 64


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix='restore-ownership-unit-')
        self.calls = []
        self.fail_remove = False
        self.simulated_owner = None

    def tearDown(self):
        shutil.rmtree(self.directory)

    def command(self, args, **kwargs):
        self.calls.append(args)
        if args[:3] == ['docker', 'rm', '-f']:
            if self.fail_remove:
                raise RuntimeError('simulated writer removal failure')
            return ''
        mount = args[args.index('--mount') + 1]
        candidate = mount.split('src=', 1)[1].split(',dst=', 1)[0]
        # Execute the real ownership program locally on ONLY the temporary
        # fixture. Docker mount/network/UID wiring is asserted separately.
        result = subprocess.run(['node', '-e', OWNERSHIP_SCRIPT, str(os.getuid()), str(os.getgid()), candidate],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if result.returncode:
            raise RuntimeError('simulated ownership container failed')
        self.simulated_owner = 'host'
        return ''

    def workspace(self, containers=None):
        return SyntheticWorkspace(IMAGE_ID, self.command, containers or [], self.directory)

    def test_private_mount_ownership_restored_before_host_inventory(self):
        workspace = self.workspace()
        with workspace as root:
            images = Path(root) / 'source-products'
            images.mkdir(mode=0o700)
            photo = images / 'synthetic.png'
            photo.write_bytes(b'synthetic image bytes')
            photo.chmod(0o600)
            workspace.register_mount(images)
            # Root test runners can reproduce actual containerUID ownership;
            # ordinary runners still exercise the exact Node program and modes.
            if os.getuid() == 0:
                try:
                    os.chown(photo, 1000, 1000)
                    os.chown(images, 1000, 1000)
                    self.assertEqual(images.stat().st_uid, 1000)
                except OSError as error:
                    # Some CI/agent user namespaces have no mapping for UID1000.
                    # The permission transition remains modelled below; the real
                    # Node ownership program still runs on the private fixture.
                    if error.errno not in [errno.EINVAL, errno.EPERM]:
                        raise
            self.simulated_owner = 'container-node'
            def host_inventory():
                if self.simulated_owner != 'host':
                    raise PermissionError('mode0700 belongs to a different UID')
                return inventory(images)
            with self.assertRaises(PermissionError):
                host_inventory()
            workspace.restore_ownership([images])
            self.assertEqual(images.stat().st_uid, os.getuid())
            self.assertEqual(photo.stat().st_uid, os.getuid())
            self.assertEqual(images.stat().st_mode & 0o777, 0o700)
            self.assertEqual(photo.stat().st_mode & 0o777, 0o600)
            self.assertEqual(host_inventory()['synthetic.png']['bytes'], 21)
            ownership = self.calls[-1]
            self.assertEqual(ownership[ownership.index('--network') + 1], 'none')
            self.assertEqual(ownership[ownership.index('--entrypoint') + 1], 'node')
            self.assertEqual(ownership[-3:], [str(os.getuid()), str(os.getgid()), '/owned'])
        self.assertFalse(Path(root).exists())

    def test_failed_smoke_stops_all_writers_before_chown_and_cleanup(self):
        workspace = self.workspace(['created-db', 'created-source', 'created-target'])
        with self.assertRaisesRegex(ValueError, 'synthetic smoke failure'):
            with workspace as root:
                images = Path(root) / 'source-products'
                images.mkdir(mode=0o700)
                workspace.register_mount(images)
                raise ValueError('synthetic smoke failure')
        self.assertEqual([call[-1] for call in self.calls[:3]], ['created-target', 'created-source', 'created-db'])
        self.assertEqual(self.calls[3][:3], ['docker', 'run', '--rm'])
        self.assertFalse(Path(root).exists())

    def test_failed_writer_stop_retains_workspace_without_chown(self):
        workspace = self.workspace(['created-db', 'created-app'])
        self.fail_remove = True
        with self.assertRaisesRegex(RuntimeError, 'workspace retained'):
            with workspace as root:
                sentinel = Path(root) / 'sentinel'
                sentinel.write_text('synthetic data')
        self.assertEqual(sentinel.read_text(), 'synthetic data')
        self.assertEqual(len(self.calls), 2)
        self.assertTrue(all(call[:3] == ['docker', 'rm', '-f'] for call in self.calls))

    def test_only_registered_synthetic_paths_and_no_symlinks_are_owned(self):
        workspace = self.workspace()
        outside = Path(self.directory) / 'outside'
        outside.mkdir()
        with workspace as root:
            with self.assertRaises(ValueError):
                workspace.register_mount(outside)
            with self.assertRaises(ValueError):
                workspace.restore_ownership([outside])
            linked = Path(root) / 'source-products'
            linked.symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                workspace.register_mount(linked)
        self.assertTrue(outside.is_dir())
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
