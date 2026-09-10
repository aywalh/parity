// Ein ZIP-Schreiber aus der Node-Standardbibliothek.
//
// Warum nicht adm-zip oder archiver: dieses Repo hat genau eine Abhaengigkeit
// (Playwright), und das ist ein Merkmal, kein Zufall. Ein Archivformat, dessen
// Aufbau seit 1989 unveraendert ist, rechtfertigt keine zweite.
//
// Geschrieben wird die einfachste gueltige Form: ein lokaler Header je Datei,
// danach das zentrale Verzeichnis. Kein ZIP64, keine Verschluesselung, keine
// Kommentare — fuer Archive unter 4 GB mit ein paar Dutzend Dateien ist das
// vollstaendig ausreichend, und jeder Entpacker versteht es.
import { deflateRawSync } from 'node:zlib';

// CRC-32, wie ZIP es verlangt. Tabelle einmal, dann ist es ein Byte-Durchlauf.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

const crc32 = buf => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// MS-DOS-Zeitstempel: 2-Sekunden-Aufloesung, Jahre ab 1980. Aelter als das
// Format selbst und immer noch das, was hier hineingehoert.
const dosTime = d => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = d => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

/**
 * @param {{name: string, data: Buffer|string}[]} files  Pfade mit "/" als Trenner.
 * @param {Date} [when]
 * @returns {Buffer}
 */
export function zip(files, when = new Date()) {
  const time = dosTime(when), date = dosDate(when);
  const parts = [], central = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(String(f.name).replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const packed = deflateRawSync(raw);
    // Wenn Komprimieren nichts bringt — schon komprimierte PNGs, WebM —, kostet
    // es nur Zeit und macht die Datei groesser. Dann roh ablegen.
    const useDeflate = packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const method = useDeflate ? 8 : 0;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // benoetigte Version
    local.writeUInt16LE(0x0800, 6);      // Bit 11: Dateiname ist UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);          // kein Extra-Feld
    parts.push(local, name, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);             // erzeugt von
    cd.writeUInt16LE(20, 6);             // benoetigte Version
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(sum, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);             // Extra
    cd.writeUInt16LE(0, 32);             // Kommentar
    cd.writeUInt16LE(0, 34);             // Startdatentraeger
    cd.writeUInt16LE(0, 36);             // interne Attribute
    cd.writeUInt32LE(0, 38);             // externe Attribute
    cd.writeUInt32LE(offset, 42);        // Position des lokalen Headers
    central.push(cd, name);

    offset += local.length + name.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);               // dieser Datentraeger
  end.writeUInt16LE(0, 6);               // Datentraeger mit Verzeichnisbeginn
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);              // kein Archivkommentar

  return Buffer.concat([...parts, cdBuf, end]);
}
