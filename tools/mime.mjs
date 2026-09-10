// Ein MIME-Tisch für alle Server hier. Lag vorher doppelt in tools/serve.mjs
// und ui/server.mjs — und war dort schon auseinandergelaufen: der UI-Server
// kannte kein .wasm, .webp oder .mp4. Der Inspect-Proxy braucht die volle Liste.
import { extname } from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2', '.hdr': 'image/vnd.radiance', '.exr': 'image/aces',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m3u8': 'application/vnd.apple.mpegurl',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf',
  '.xml': 'application/xml', '.csv': 'text/csv; charset=utf-8',
  // Binäre Szenendaten: Buffer, Splats, Rive, Draco/Basis
  '.buf': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.sog': 'application/octet-stream', '.riv': 'application/octet-stream',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.basis': 'application/octet-stream', '.drc': 'application/octet-stream', '.ply': 'application/octet-stream',
};

export const typeOf = p => MIME[extname(p).toLowerCase()] || 'application/octet-stream';
