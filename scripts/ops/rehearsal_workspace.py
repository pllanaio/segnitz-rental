"""Lifecycle for directories and container IDs created by a synthetic rehearsal.

The normal application entrypoint retains its node UID and private directory
modes. A separate offline container returns only registered synthetic bind mounts
to the invoking host UID before backup and before deleting the workspace.
"""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


OWNERSHIP_SCRIPT = r"""
const fs = require('node:fs');
const path = require('node:path');
const [uidText, gidText, root] = process.argv.slice(1);
const [uid, gid] = [uidText, gidText].map(Number);
if (![uid, gid].every(value => Number.isSafeInteger(value) && value >= 0)) process.exit(1);
function restore(entry) {
    const stat = fs.lstatSync(entry);
    if (stat.isSymbolicLink() || !(stat.isDirectory() || stat.isFile())) throw new Error('Unsafe synthetic entry');
    if (stat.isDirectory()) for (const name of fs.readdirSync(entry)) restore(path.join(entry, name));
    fs.chownSync(entry, uid, gid);
}
restore(root);
"""


class SyntheticWorkspace:
    def __init__(self, image_id, command, containers, temp_directory):
        if not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id):
            raise ValueError('Immutable rehearsal image ID required')
        self.image_id = image_id
        self.command = command
        self.containers = containers
        self.temp_directory = temp_directory
        self.mounts = []
        self.uid, self.gid = os.getuid(), os.getgid()
        self.root = None

    def __enter__(self):
        # No implicit TemporaryDirectory finalizer: failed writer shutdown must
        # preserve the workspace, not attempt deletion underneath a live writer.
        self.root = Path(tempfile.mkdtemp(prefix='segnitz-restore-rehearsal-', dir=self.temp_directory)).resolve()
        return str(self.root)

    def register_mount(self, directory):
        candidate = Path(directory).absolute()
        if self.root is None or not candidate.is_relative_to(self.root) or candidate == self.root:
            raise ValueError('Only this rehearsal workspace may be registered')
        relative = candidate.relative_to(self.root)
        if relative not in [Path('source-products'), Path('source-returns'), Path('restored/products'), Path('restored/returns')]:
            raise ValueError('Only synthetic image directories may be registered')
        # Every ancestor must remain inside the privately owned workspace.
        if candidate.resolve() != candidate or not candidate.is_dir():
            raise ValueError('Synthetic image mount must be a real directory')
        if candidate not in self.mounts:
            self.mounts.append(candidate)

    def restore_ownership(self, directories):
        for directory in directories:
            candidate = Path(directory).absolute()
            if candidate not in self.mounts or candidate.resolve() != candidate:
                raise ValueError('Unregistered synthetic ownership target')
            self.command(['docker', 'run', '--rm', '--network', 'none', '--read-only',
                '--user', '0:0', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE',
                '--pids-limit', '32', '--memory', '128m', '--cpus', '1', '--entrypoint', 'node',
                '--mount', f'type=bind,src={candidate},dst=/owned', self.image_id,
                '-e', OWNERSHIP_SCRIPT, str(self.uid), str(self.gid), '/owned'], timeout=40)

    def __exit__(self, exception_type, exception, traceback):
        stop_failed = False
        # IDs come only from successful create commands in this run. No broad
        # Docker discovery, existing-volume removal or database reset is allowed.
        for container in reversed(self.containers):
            try:
                self.command(['docker', 'rm', '-f', '-v', container], timeout=40)
            except (RuntimeError, OSError, subprocess.TimeoutExpired):
                stop_failed = True
        if stop_failed:
            raise RuntimeError('Synthetic writer cleanup failed; workspace retained') from None
        self.restore_ownership(self.mounts)
        shutil.rmtree(self.root)
        return False
