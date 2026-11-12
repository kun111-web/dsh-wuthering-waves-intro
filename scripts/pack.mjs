import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import characters from '../src/characters.json' with { type: 'json' };
import sketches from '../src/sketches.json' with { type: 'json' };
import manifest from '../package.json' with { type: 'json' };
import lock from '../package-lock.json' with { type: 'json' };

const root = join(import.meta.dirname, '..');
const filename = `${manifest.name}-${manifest.version}.tgz`;
assert.ok(manifest.description.startsWith(`v${manifest.version} · `));
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);
assert.equal(lock.packages[''].engines.dsh, manifest.engines.dsh);
assert.ok((await readFile(join(root, 'src/client.js'), 'utf8')).includes(`const version = '${manifest.version}'`));
assert.ok((await readFile(join(root, 'install.ps1'), 'utf8')).includes(`dist\\${filename}`));

async function sha256(file) {
  const checksum = createHash('sha256');
  for await (const chunk of createReadStream(file)) checksum.update(chunk);
  return checksum.digest('hex');
}

const stage = await mkdtemp(join(tmpdir(), 'dsh-wuwa-pack-'));
const archive = join(stage, filename);
try {
  execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--json', '--pack-destination', stage], {
    cwd: root, encoding: 'utf8'
  });
  const packed = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(packed.name, manifest.name);
  assert.equal(packed.version, manifest.version);
  const contents = new Set(execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/));
  for (const file of ['src/index.js', 'src/client.js', 'src/playback.js', 'src/effects.js', 'src/style.css',
    'src/characters.json', 'src/sketches.json',
    'cordis.patch.yml', 'LICENSE', 'NOTICE.md', 'README.md', 'assets/SOURCE.json']) assert.ok(contents.has(`package/${file}`), file);
  for (const { id } of characters) {
    assert.ok(contents.has(`package/assets/characters/${id}.mp4`), id);
    assert.ok(contents.has(`package/assets/characters/${id}.webp`), id);
    assert.ok(sketches.characters[id]?.paths.length, `Missing sketch for ${id}`);
    assert.ok(Number.isInteger(sketches.characters[id].startFrame) && sketches.characters[id].startFrame >= 0 &&
      sketches.characters[id].startFrame <= 12, `Invalid full entry frame for ${id}`);
    const quick = sketches.characters[id].quick;
    assert.ok(quick.paths.length, `Missing quick sketch for ${id}`);
    const character = characters.find(character => character.id === id);
    assert.ok(Number.isInteger(quick.startFrame) && Number.isInteger(quick.endFrame) && quick.startFrame >= 0 &&
      quick.endFrame <= character.end - character.start && quick.endFrame > quick.startFrame &&
      quick.endFrame - quick.startFrame <= 60, `Invalid quick window for ${id}`);
    const signal = sketches.characters[id].signal;
    assert.ok(signal?.length === 56 && signal.every(level => Number.isInteger(level) && level >= 0 && level <= 100),
      `Invalid motion profile for ${id}`);
  }
  const videos = [...contents].filter(file => file.endsWith('.mp4'));
  assert.equal(videos.length, characters.length, '安装包只能包含正式角色视频');
  assert.ok(videos.every(file => characters.some(({ id }) => file === `package/assets/characters/${id}.mp4`)));

  const dist = join(root, 'dist');
  await mkdir(dist, { recursive: true });
  const destination = join(dist, filename);
  const checksum = await sha256(archive);
  const sumsFile = join(dist, 'SHA256SUMS.txt');
  const sums = (await readFile(sumsFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  })).trimEnd();
  const previous = sums.split(/\r?\n/).find(line => line.split(/\s+/)[1] === filename);
  if (previous) assert.equal(previous.split(/\s+/)[0], checksum, '同版本安装包内容变化，请先升版。');
  try {
    await copyFile(archive, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.equal(await sha256(destination), checksum, '同版本安装包内容变化，请先升版。');
  }
  if (!previous) await writeFile(sumsFile, `${sums ? sums + '\n' : ''}${checksum}  ${filename}\n`);
  console.log(`${checksum}  ${destination}`);
} finally {
  await unlink(archive).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(stage);
}
