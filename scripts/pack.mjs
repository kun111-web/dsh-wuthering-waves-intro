import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import characters from '../src/characters.json' with { type: 'json' };
import sketches from '../src/sketches.json' with { type: 'json' };
import manifest from '../package.json' with { type: 'json' };
import lock from '../package-lock.json' with { type: 'json' };

const root = join(import.meta.dirname, '..');
const filename = manifest.name + '-' + manifest.version + '.tgz';
assert.ok(manifest.description.startsWith('v' + manifest.version + ' · '));
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);
assert.equal(lock.packages[''].engines.dsh, manifest.engines.dsh);
assert.deepEqual(Object.keys(lock.packages), ['']);
assert.ok((await readFile(join(root, 'src/client.js'), 'utf8')).includes("const version = '" + manifest.version + "'"));
assert.ok((await readFile(join(root, 'install.ps1'), 'utf8')).includes('dist\\' + filename));

for (const { id, start, end } of characters) {
  const item = sketches.characters[id];
  assert.ok(item?.paths.length, 'Missing sketch for ' + id);
  assert.ok(Number.isInteger(item.startFrame) && item.startFrame >= 0 && item.startFrame <= 12);
  const quick = item.quick;
  assert.ok(quick?.paths.length && Number.isInteger(quick.startFrame) && Number.isInteger(quick.endFrame));
  assert.ok(quick.startFrame >= 0 && quick.endFrame <= end - start && quick.endFrame - quick.startFrame <= 60);
  assert.ok(item.signal?.length === 56 && item.signal.every(level => Number.isInteger(level) && level >= 0 && level <= 100));
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const stage = await mkdtemp(join(root, '.pack-'));
const archive = join(stage, filename);
const stagedSums = join(stage, 'SHA256SUMS.txt');
try {
  const [pack] = JSON.parse(execFileSync(process.execPath, [
    process.env.npm_execpath, 'pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', stage
  ], { cwd: root, encoding: 'utf8' }));
  assert.equal(pack.filename, filename);
  const packed = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  assert.equal(packed.description, manifest.description);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(Object.keys(packed[field] ?? {}), [], '安装包包含外部依赖：' + field);
  }
  assert.ok((await stat(archive)).size < 2 * 1024 ** 3, 'GitHub Release 附件必须小于 2 GiB');
  const contents = pack.files.map(file => file.path);
  for (const file of ['src/index.js', 'src/client.js', 'src/playback.js', 'src/effects.js', 'src/style.css',
    'src/characters.json', 'src/sketches.json', 'cordis.patch.yml', 'LICENSE', 'NOTICE.md', 'README.md',
    'assets/SOURCE.json']) assert.ok(contents.includes(file), file);
  for (const extension of ['mp4', 'webp']) {
    const expected = characters.map(({ id }) => 'assets/characters/' + id + '.' + extension).sort();
    assert.deepEqual(contents.filter(file => file.endsWith('.' + extension)).sort(), expected);
  }
  assert.ok(!contents.some(file => /(?:^|\/)(?:test|qa|output|node_modules|\.pack-[^/]+)\//.test(file)));

  const dist = join(root, 'dist');
  await mkdir(dist, { recursive: true });
  const sumsFile = join(dist, 'SHA256SUMS.txt');
  const sums = (await readFile(sumsFile, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
  })).trimEnd();
  const checksum = await sha256(archive);
  const destination = join(dist, filename);
  const previous = sums.split(/\r?\n/).find(line => line.split(/\s+/)[1] === filename);
  if (previous) assert.equal(previous.split(/\s+/)[0], checksum, '同版本安装包内容变化，请先升版。');
  try { await link(archive, destination); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.equal(await sha256(destination), checksum, '同版本安装包内容变化，请先升版。');
  }
  if (!previous) {
    await writeFile(stagedSums, (sums ? sums + '\n' : '') + checksum + '  ' + filename + '\n');
    await rename(stagedSums, sumsFile);
  }
  console.log(checksum + '  ' + destination);
} finally {
  for (const file of [archive, stagedSums]) {
    await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  await rmdir(stage);
}
