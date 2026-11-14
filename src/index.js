import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import manifest from '../package.json' with { type: 'json' };
import characters from './characters.json' with { type: 'json' };
import sketches from './sketches.json' with { type: 'json' };

export const name = 'dsh-wuthering-waves-intro';
export const inject = ['webServer'];
const assetPath = '/dsh-wuthering-waves-intro/media';
const runtime = { version: manifest.version, sessionId: randomUUID(), hostRange: manifest.engines.dsh };
const etag = value => `"${createHash('sha256').update(value).digest('hex')}"`;
const outlineTags = new Map();
const clips = new Map();
const outlineAssets = new Map();
const artwork = { width: sketches.width, height: sketches.height, characters: Object.create(null) };
for (const { id } of characters) {
  clips.set(`${id}.mp4`, 'video/mp4');
  clips.set(`${id}.webp`, 'image/webp');
  const { paths, quick: { paths: quickPaths, ...quick }, ...appearance } = sketches.characters[id];
  artwork.characters[id] = { ...appearance, quick };
  outlineAssets.set(`${id}.json`, JSON.stringify(paths));
  outlineAssets.set(`${id}-quick.json`, JSON.stringify(quickPaths));
}
for (const [file, body] of outlineAssets) outlineTags.set(file, etag(body));

let clientAssets;
export function loadClientAssets() {
  return clientAssets ??= Promise.all([
    readFile(new URL('./effects.js', import.meta.url), 'utf8'),
    readFile(new URL('./playback.js', import.meta.url), 'utf8'),
    readFile(new URL('./style.css', import.meta.url), 'utf8')
  ]).then(([effects, script, styles]) => {
    const bootstrap = `(() => {\ntry {\nconst artwork = ${JSON.stringify(artwork)};\nconst runtime = ${JSON.stringify(runtime)};\nconst characters = ${JSON.stringify(characters)};\n${effects}\n${script}\n} catch (error) { console.warn('[鸣潮入场动画] 初始化失败，已跳过动画。', error); }\n})();`;
    return { bootstrap, styles };
  }).catch(error => { clientAssets = undefined; throw error; });
}

function byteRange(header, size) {
  if (header === null) return { start: 0, end: size - 1 };
  const range = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!range || (!range[1] && !range[2])) return null;
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
  return { start, end };
}

export async function serveMedia(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const version = url.searchParams.get('v');
  if (version !== null && version !== runtime.version) return new Response(null, { status: 404 });
  const cache = version ? 'private, max-age=31536000, immutable' : 'private, max-age=0';
  const fresh = tag => request.headers.get('if-none-match')?.split(',').some(value => value.trim().replace(/^W\//, '') === tag || value.trim() === '*');
  if (!pathname.startsWith(assetPath + '/')) return new Response(null, { status: 404 });
  const filename = pathname.slice(assetPath.length + 1);
  if (filename === 'runtime.js' || filename === 'style.css') {
    const { bootstrap, styles } = await loadClientAssets();
    const body = filename === 'runtime.js' ? bootstrap : styles;
    const tag = etag(body);
    // The runtime includes this host session's identity: revalidate after a restart.
    const headers = { 'Content-Type': filename === 'runtime.js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
      'Cache-Control': 'private, no-cache', ETag: tag, 'X-Content-Type-Options': 'nosniff' };
    if (fresh(tag)) return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : body, { headers });
  }
  const outlines = outlineAssets.get(filename);
  if (outlines !== undefined) {
    const tag = outlineTags.get(filename);
    if (fresh(tag)) return new Response(null, { status: 304, headers: { ETag: tag, 'Cache-Control': cache } });
    return new Response(request.method === 'HEAD' ? null : outlines, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(outlines)),
        'Cache-Control': cache,
        ETag: tag,
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
  const type = clips.get(filename);
  if (!type) return new Response(null, { status: 404 });
  const file = new URL(`../assets/characters/${filename}`, import.meta.url);
  let info;
  try { info = await stat(file); } catch { return new Response(null, { status: 404 }); }
  if (!info.isFile() || info.size === 0) return new Response(null, { status: 404 });

  const tag = `W/${etag(`${runtime.version}:${filename}:${info.size}:${info.mtimeMs}`)}`;
  if (fresh(tag.slice(2))) return new Response(null, { status: 304, headers: { ETag: tag, 'Cache-Control': cache } });
  // A weak metadata validator cannot satisfy If-Range: send the complete resource.
  const header = request.headers.has('if-range') ? null : request.headers.get('range');
  const range = byteRange(header, info.size);
  if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
  const { start, end } = range;
  const headers = {
    'Content-Type': type,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
    ETag: tag,
    'X-Content-Type-Options': 'nosniff'
  };
  if (header !== null) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(file, { start, end }));
  return new Response(body, { status: header === null ? 200 : 206, headers });
}

export async function apply(ctx) {
  if (typeof ctx.webServer?.register !== 'function' || typeof ctx.effect !== 'function' || typeof ctx.on !== 'function') {
    console.warn('[鸣潮入场动画] 当前 DSH 缺少媒体扩展接口，已跳过动画。');
    return;
  }
  const { bootstrap, styles } = await loadClientAssets();
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: assetPath, resource: serveMedia }));
  ctx.on('webserver/index-inject', rows => {
    if (!Array.isArray(rows)) return;
    rows.push(
      { kind: 'style', text: styles },
      { kind: 'script', placement: 'body-start', text: bootstrap }
    );
  });
}
