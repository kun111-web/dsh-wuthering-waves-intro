import { execFileSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import characters from '../src/characters.json' with { type: 'json' };
import { cleanupFilters, recordCleanedMedia } from './clean-media.mjs';

const assets = join(import.meta.dirname, '..', 'assets');
const source = process.argv[2] ? resolve(process.argv[2]) : join(assets, 'source-2160p.mp4');
await access(source).catch(() => { throw new Error('请提供与角色时间轴匹配的 2160p 源视频：npm run split -- <完整路径>'); });
const output = join(assets, 'characters');
await mkdir(output, { recursive: true });

const fps = 30;
const seconds = frames => (frames / fps).toFixed(8);
const ffmpeg = args => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args], { stdio: 'inherit' });
// Keep the active picture between the source's upper matte and its lower-left titles.
const cleanFrame = 'crop=3840:1488:0:204,setsar=1';
for (const { id, name, start, end } of characters) {
  const clip = join(output, `${id}.mp4`);
  // Catalog positions remain on the original 30 Hz editing timeline; the new source is 60 fps.
  ffmpeg(['-ss', seconds(start), '-i', source, '-map', '0:v:0',
    '-vf', [cleanFrame, ...cleanupFilters(id)].join(','), '-frames:v', String((end - start) * 2),
    '-an', '-sn', '-dn', '-map_metadata', '-1', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', clip]);
  ffmpeg(['-ss', seconds(Math.floor((end - start) * 0.64)), '-i', clip, '-frames:v', '1',
    '-vf', 'scale=768:-2:flags=lanczos,setsar=1', '-c:v', 'libwebp', '-quality', '86', join(output, `${id}.webp`)]);
  console.log(`${name} ${seconds(start)}–${seconds(end)}s`);
}
await recordCleanedMedia();
