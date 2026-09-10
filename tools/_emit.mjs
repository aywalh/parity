// NDJSON-Ereignisstrom für die UI. Ohne --json ändert sich am Verhalten nichts.
//
// Das Flag wird hier aus argv entfernt, bevor irgendein Tool seine Argumente
// liest — sonst landet "--json" bei fetch-assets als Seed-Datei und bei
// interact hinter --steps. Ein Ort, alle Aufrufer.
export const JSON_MODE = process.argv.includes('--json');

if (JSON_MODE) {
  process.argv = process.argv.filter(a => a !== '--json');
  console.log = () => {};   // hübsche Ausgabe würde den Strom zerreißen
}

export const emit = o => { if (JSON_MODE) process.stdout.write(JSON.stringify(o) + '\n'); };

// Familie für den Asset-Graphen. Gruppiert nach dem, was die Datei im Browser tut.
const FAMILY = {
  webp: 'images', png: 'images', jpg: 'images', jpeg: 'images', avif: 'images',
  gif: 'images', svg: 'images', ico: 'images',
  ktx2: 'textures', basis: 'textures', hdr: 'textures', exr: 'textures',
  glb: 'models', gltf: 'models', buf: 'models', bin: 'models', draco: 'models',
  sog: 'splats', ply: 'splats',
  woff2: 'fonts', woff: 'fonts', ttf: 'fonts', otf: 'fonts',
  js: 'code', mjs: 'code', wasm: 'code', riv: 'code',
  css: 'style', html: 'markup', json: 'data', webmanifest: 'data',
  mp4: 'media', webm: 'media', mov: 'media', mp3: 'media',
};
export const family = p => FAMILY[(p.split('.').pop() || '').toLowerCase()] || 'other';
