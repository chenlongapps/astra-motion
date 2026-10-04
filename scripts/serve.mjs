import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { root, option } from './render-options.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.png': 'image/png' };
const inside = (base, file) => file.startsWith(base + path.sep);

export function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) throw new Error('Invalid byte range');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || (!match[1] && Number(match[2]) === 0)) throw new Error('Invalid byte range');
  return { start, end };
}

// Only the web entry point, animation source, public assets, and exported media
// are served. Repository metadata and tooling are never exposed over HTTP.
export async function createStaticServer({ directory = root, publicAssets = true, port = 0 } = {}) {
  const base = await realpath(directory);
  const server = createServer(async (request, response) => {
    const reply = (status, message, headers = {}) => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers }); response.end(request.method === 'HEAD' ? undefined : message); };
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { reply(405, 'Method not allowed', { Allow: 'GET, HEAD' }); return; }
      let url;
      try { url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { reply(400, 'Invalid URL'); return; }
      if (url.includes('\\') || url.includes('\0') || url.split('/').some(part => part.startsWith('.'))) { reply(404, 'Not found'); return; }
      if (url === '/' || url.endsWith('/index.html')) url = url === '/' ? '/index.html' : url;
      if (!/^\/(?:index\.html|THIRD_PARTY\.md|src\/[^/]+\.(?:js|css|json)|(?:audio|fonts)\/[^/]+|output\/(?:4k\/)?[^/]+\.mp4)$/.test(url)) { reply(404, 'Not found'); return; }
      const asset = publicAssets && /^\/(?:audio|fonts)\//.test(url);
      const candidate = path.resolve(base, asset ? 'public' : '.', '.' + url);
      if (!inside(base, candidate)) { reply(404, 'Not found'); return; }
      const file = await realpath(candidate);
      if (!inside(base, file)) { reply(404, 'Not found'); return; }
      const info = await stat(file);
      if (!info.isFile()) { reply(404, 'Not found'); return; }
      let range;
      if (request.headers.range) {
        try { range = byteRange(request.headers.range, info.size); }
        catch { reply(416, 'Range not satisfiable', { 'Content-Range': `bytes */${info.size}` }); return; }
      }
      response.writeHead(range ? 206 : 200, {
        'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
        'Content-Length': range ? range.end - range.start + 1 : info.size,
        'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
        ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${info.size}` } : {}),
      });
      if (request.method === 'HEAD') response.end();
      else await pipeline(createReadStream(file, range), response);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      reply(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500, 'File unavailable');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    async close() {
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections(); await closed;
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const preview = process.argv.includes('--preview');
  const value = option(process.argv.slice(2), '--port') ?? (preview ? '4173' : '5173');
  if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('Use --port=0…65535.');
  const server = await createStaticServer({ directory: preview ? path.join(root, 'dist') : root, publicAssets: !preview, port: Number(value) });
  console.log(`${preview ? 'Preview' : 'Player'}: ${server.url}\nRefresh the browser after editing source files.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close(); });
}
