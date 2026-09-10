// Static server for the clone with the MIME types the WebGL/Rive runtime needs.
// Usage: node tools/serve.mjs [root] [port] [--host 0.0.0.0]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { MIME } from './mime.mjs';

// Loopback by default — a clone is somebody else's site rendered on your
// machine, and it has no business being reachable from the local network.
// Opening it up is a deliberate flag: --host 0.0.0.0
const ARGS = process.argv.slice(2);
const flag = name => {
  const i = ARGS.indexOf(name);
  if (i !== -1 && ARGS[i + 1]) return ARGS[i + 1];
  const eq = ARGS.find(a => a.startsWith(name + '='));
  return eq ? eq.slice(name.length + 1) : undefined;
};
const POS = ARGS.filter((a, i) => !a.startsWith('--') && ARGS[i - 1] !== '--host');
const ROOT = POS[0] ?? 'clone';
const PORT = Number(POS[1] ?? 4173);
const HOST = flag('--host') ?? '127.0.0.1';



createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let p = join(ROOT, normalize(url).replace(/^(\.\.[/\\])+/, ''));
  try {
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
  } catch {
    // Astro-style clean routes: /foo -> /foo/index.html, else SPA fallback to root.
    try { statSync(p + '/index.html'); p = p + '/index.html'; }
    catch { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404 ' + url); }
  }
  let size;
  try { size = statSync(p).size; } catch { res.writeHead(404); return res.end('404'); }

  const type = MIME[extname(p).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range; // videos need 206 or Chrome stalls
  if (range && /^bytes=/.test(range)) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = Number(s), end = e ? Number(e) : size - 1;
    res.writeHead(206, {
      'content-type': type, 'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1,
      'access-control-allow-origin': '*',
    });
    return createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, {
    'content-type': type, 'content-length': size, 'accept-ranges': 'bytes',
    'access-control-allow-origin': '*', 'cache-control': 'no-cache',
  });
  createReadStream(p).pipe(res);
}).listen(PORT, HOST, () => console.log(`serving ${ROOT} → http://localhost:${PORT}`));
