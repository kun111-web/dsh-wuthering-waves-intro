import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, link, mkdir, mkdtemp, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import characters from '../src/characters.json' with { type: 'json' };
import groups from '../src/media-packages.json' with { type: 'json' };
import sketches from '../src/sketches.json' with { type: 'json' };
import manifest from '../package.json' with { type: 'json' };
import lock from '../package-lock.json' with { type: 'json' };

const root = join(import.meta.dirname, '..');
const archiveName = name => `${name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`;
assert.ok(manifest.description.startsWith(`v${manifest.version} · `));
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);
assert.equal(lock.packages[''].engines.dsh, manifest.engines.dsh);
assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
assert.ok((await readFile(join(root, 'src/client.js'), 'utf8')).includes(`const version = '${manifest.version}'`));
assert.ok((await readFile(join(root, 'install.ps1'), 'utf8')).includes(`dist\\${archiveName(manifest.name)}`));
assert.equal(groups.length, 6);
const assigned = groups.flatMap(group => group.characters);
assert.equal(new Set(assigned).size, characters.length);
assert.equal(assigned.length, characters.length);
assert.deepEqual([...assigned].sort(), characters.map(({ id }) => id).sort());
for (const group of groups) assert.equal(manifest.dependencies[group.package], manifest.version);
for (const { id, start, end } of characters) {
  const item = sketches.characters[id];
  assert.ok(item?.paths.length, `Missing sketch for ${id}`);
  assert.ok(Number.isInteger(item.startFrame) && item.startFrame >= 0 && item.startFrame <= 12);
  const quick = item.quick;
  assert.ok(quick.paths.length && Number.isInteger(quick.startFrame) && Number.isInteger(quick.endFrame));
  assert.ok(quick.startFrame >= 0 && quick.endFrame <= end - start && quick.endFrame > quick.startFrame && quick.endFrame - quick.startFrame <= 60);
  assert.ok(item.signal?.length === 56 && item.signal.every(level => Number.isInteger(level) && level >= 0 && level <= 100));
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const stage = await mkdtemp(join(root, '.pack-'));
const createdFiles = [], createdDirs = [stage], archives = [];
async function stagedWrite(path, value) { createdFiles.push(path); await writeFile(path, value); }
async function pack(cwd, name) {
  const filename = archiveName(name), archive = join(stage, filename);
  createdFiles.push(archive);
  execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--json', '--pack-destination', stage], { cwd, encoding: 'utf8' });
  const packed = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(packed.name, name); assert.equal(packed.version, manifest.version);
  const contents = new Set(execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/));
  assert.ok((await stat(archive)).size < 60 * 1024 * 1024, 'Each publishable archive must stay below 60 MiB');
  archives.push({ filename, archive });
  return contents;
}
try {
  for (const [index, group] of groups.entries()) {
    const dir = join(stage, `media-${index + 1}`), media = join(dir, 'characters');
    await mkdir(dir); createdDirs.push(dir); await mkdir(media); createdDirs.push(media);
    await stagedWrite(join(dir, 'package.json'), JSON.stringify({
      name: group.package, version: manifest.version,
      description: `Wuthering Waves character animation assets ${index + 1}/6 for dsh-wuthering-waves-intro`,
      license: 'SEE LICENSE IN NOTICE.md', author: manifest.author,
      repository: manifest.repository, homepage: manifest.homepage,
      publishConfig: manifest.publishConfig, files: ['characters', 'NOTICE.md', 'README.md']
    }, null, 2) + '\n');
    await stagedWrite(join(dir, 'NOTICE.md'), '动画素材：鸣潮角色声痕动画。鸣潮相关素材归库洛游戏及相关权利人所有。本素材包中的视频、角色形象及相关素材不采用插件代码的 Apache-2.0 许可，不代表鸣潮、库洛游戏或 DeepSeek 官方。\n');
    await stagedWrite(join(dir, 'README.md'), `# ${group.package}\n\n动画素材：鸣潮角色声痕动画。由 dsh-wuthering-waves-intro 自动安装的正式素材依赖，无需在 DSH 中单独启用。包含 ${group.characters.length} 个 3840×1488、60 fps、无音轨的 H.264 视频。\n\n鸣潮相关素材归库洛游戏及相关权利人所有。这些素材不属于插件代码的 Apache-2.0 授权范围，详见 NOTICE.md。\n`);
    for (const id of group.characters) {
      const destination = join(media, `${id}.mp4`); createdFiles.push(destination);
      // The staging directory stays on the source volume; hard links avoid duplicate video copies.
      await link(join(root, 'assets', 'characters', `${id}.mp4`), destination);
    }
    const contents = await pack(dir, group.package);
    assert.equal([...contents].filter(file => file.endsWith('.mp4')).length, group.characters.length);
    for (const id of group.characters) assert.ok(contents.has(`package/characters/${id}.mp4`));
  }
  const contents = await pack(root, manifest.name);
  for (const file of ['src/index.js', 'src/client.js', 'src/playback.js', 'src/effects.js', 'src/style.css',
    'src/media.js', 'src/media-packages.json', 'src/characters.json', 'src/sketches.json',
    'cordis.patch.yml', 'LICENSE', 'NOTICE.md', 'README.md', 'assets/SOURCE.json']) assert.ok(contents.has(`package/${file}`), file);
  for (const { id } of characters) assert.ok(contents.has(`package/assets/characters/${id}.webp`), id);
  assert.equal([...contents].filter(file => file.endsWith('.mp4')).length, 0, 'Videos belong in media dependencies');
  assert.ok(![...contents].some(file => /\/(?:test|qa|output|node_modules|\.pack-[^/]+)\//.test(file)));
  const dist = join(root, 'dist'); await mkdir(dist, { recursive: true });
  const sumsFile = join(dist, 'SHA256SUMS.txt');
  let sums = (await readFile(sumsFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; })).trimEnd();
  for (const { filename, archive } of archives) {
    const checksum = await sha256(archive), destination = join(dist, filename);
    const previous = sums.split(/\r?\n/).find(line => line.split(/\s+/)[1] === filename);
    if (previous) assert.equal(previous.split(/\s+/)[0], checksum, '同版本安装包内容变化，请先升版。');
    try { await copyFile(archive, destination, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(await sha256(destination), checksum, '同版本安装包内容变化，请先升版。'); }
    if (!previous) sums += `${sums ? '\n' : ''}${checksum}  ${filename}`;
    console.log(`${checksum}  ${destination}`);
  }
  await writeFile(sumsFile, sums + '\n');
} finally {
  for (const file of createdFiles.reverse()) await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  for (const dir of createdDirs.reverse()) await rmdir(dir);
}
