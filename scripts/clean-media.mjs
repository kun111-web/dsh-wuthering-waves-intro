import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import regions from './media-cleanup.json' with { type: 'json' };
import characters from '../src/characters.json' with { type: 'json' };

const root = join(import.meta.dirname, '..');
const recordFile = join(root, 'assets', 'MEDIA-CLEANUP.json');
export function cleanupFilters(id) {
  return (regions[id] ?? []).map(({ x, y, w, h, from, until }) => {
    if (![x, y, w, h].every(Number.isInteger) || x <= 0 || y <= 0 || w <= 0 || h <= 0 || x + w >= 3840 || y + h >= 1488) throw Error(`Invalid cleanup region: ${id}`);
    const enabled = [from === undefined ? null : `gte(t,${from})`, until === undefined ? null : `lte(t,${until})`].filter(Boolean).join('*');
    return `delogo=x=${x}:y=${y}:w=${w}:h=${h}${enabled ? `:enable='${enabled}'` : ''}`;
  });
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function recordCleanedMedia() {
  const files = {};
  for (const id of Object.keys(regions)) files[id] = {
    sha256: await sha256(join(root, 'assets', 'characters', `${id}.mp4`)),
    filters: cleanupFilters(id)
  };
  await writeFile(recordFile, JSON.stringify({ width: 3840, height: 1488, fps: 60, audio: false, files }, null, 2) + '\n');
}
async function clean() {
  const previous = JSON.parse(await readFile(recordFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '{}';
    throw error;
  }));
  const stage = await mkdtemp(join(tmpdir(), 'dsh-wuwa-clean-'));
  try {
    for (const id of Object.keys(regions)) {
      const file = join(root, 'assets', 'characters', `${id}.mp4`);
      const filters = cleanupFilters(id);
      if (previous.files?.[id]?.sha256 === await sha256(file) && JSON.stringify(previous.files[id].filters) === JSON.stringify(filters)) {
        console.log(`${id}: already cleaned`); continue;
      }
      const output = join(stage, `${id}.mp4`);
      execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', file, '-map', '0:v:0',
        '-vf', [...filters, 'setsar=1'].join(','), '-an', '-sn', '-dn', '-map_metadata', '-1',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { stdio: 'inherit' });
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames,r_frame_rate', '-of', 'json', output], { encoding: 'utf8' }));
      const character = characters.find(c => c.id === id);
      const expected = [{ codec_name: 'h264', width: 3840, height: 1488, r_frame_rate: '60/1', nb_frames: String((character.end - character.start) * 2) }];
      if (JSON.stringify(probe.streams) !== JSON.stringify(expected)) throw Error(`Output failed validation: ${id}`);
      await copyFile(output, file); await unlink(output);
      execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-ss', String(Math.floor((character.end - character.start) * .64) / 30), '-i', file,
        '-frames:v', '1', '-vf', 'scale=768:-2:flags=lanczos,setsar=1', '-c:v', 'libwebp', '-quality', '86', join(root, 'assets', 'characters', `${id}.webp`)], { stdio: 'inherit' });
      console.log(`${id}: captions removed, 3840x1488 / 60 fps, no audio`);
    }
    await recordCleanedMedia();
  } finally {
    for (const id of Object.keys(regions)) await unlink(join(stage, `${id}.mp4`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(stage);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await clean();
