'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('OCI scan preparation extracts identical blobs and rejects unsafe archive entries', () => {
    const result = spawnSync('python3', ['-c', `
import importlib.util, io, pathlib, tarfile, tempfile
spec = importlib.util.spec_from_file_location('prepare', 'scripts/prepare-oci-scan.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='segnitz-oci-test-') as temporary:
 root = pathlib.Path(temporary)
 def archive(name, entries):
  target = root / name
  with tarfile.open(target, 'w') as out:
   for path, body, kind in entries:
    info = tarfile.TarInfo(path); info.size = len(body); info.type = kind
    out.addfile(info, io.BytesIO(body))
  return target
 good = [('index.json', b'{}', tarfile.REGTYPE), ('oci-layout', b'{}', tarfile.REGTYPE), ('blobs/sha256/' + 'a'*64, b'unchanged blob', tarfile.REGTYPE)]
 module.prepare(archive('good.tar',good),root/'good')
 assert (root/'good'/good[-1][0]).read_bytes() == b'unchanged blob'
 try: module.prepare(root/'good.tar',root/'good')
 except FileExistsError: pass
 else: raise AssertionError('existing target overwritten')
 for index, extra in enumerate([('../escape',b'bad',tarfile.REGTYPE),('/escape',b'bad',tarfile.REGTYPE),('link',b'',tarfile.SYMTYPE),good[0]]):
  target=root/f'bad-{index}'
  try: module.prepare(archive(f'bad-{index}.tar',good+[extra]),target)
  except ValueError: pass
  else: raise AssertionError('unsafe archive accepted')
  assert not target.exists()
 assert not (root/'escape').exists()
`], {cwd: path.resolve(__dirname, '..'), encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
});
