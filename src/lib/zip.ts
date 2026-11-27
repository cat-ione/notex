// Zip files, as small as backing up notes needs: writing stores each file as it is (notes are
// small text, and a backup should open anywhere), reading takes stored and deflated files (a
// backup unzipped and zipped again by another program).

export type ZipEntry = { name: string; data: Uint8Array };

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS time and date (zip's own), for `when`. */
function dosTime(when: Date): [number, number] {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  return [time, date];
}

/** A zip of the files, each stored (not compressed). */
export function zip(files: ZipEntry[], when = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const [time, date] = dosTime(when);
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let at = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const head = new Uint8Array(30 + name.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // (names in UTF-8)
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, n, true);
    h.setUint32(22, n, true);
    h.setUint16(26, name.length, true);
    head.set(name, 30);
    const dir = new Uint8Array(46 + name.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(12, time, true);
    d.setUint16(14, date, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, n, true);
    d.setUint32(24, n, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, at, true);
    dir.set(name, 46);
    local.push(head, f.data);
    central.push(dir);
    at += head.length + n;
  }
  const dirSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, dirSize, true);
  e.setUint32(16, at, true);
  const out = new Uint8Array(at + dirSize + 22);
  let p = 0;
  for (const part of [...local, ...central, end]) out.set(part, p), (p += part.length);
  return out;
}

async function inflate(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** The files in a zip (folders left out). Throws if it isn't one. */
export async function unzip(b: Uint8Array): Promise<ZipEntry[]> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // the end record: the last thing in the file, but for a comment of up to 64k after it
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip file');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const utf8 = new TextDecoder(), latin = new TextDecoder('latin1');
  const out: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('a broken zip file');
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true), nameLen = v.getUint16(p + 28, true);
    const extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true), at = v.getUint32(p + 42, true);
    const raw = b.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x0800 ? utf8 : latin).decode(raw);
    p += 46 + nameLen + extra + comment;
    if (name.endsWith('/')) continue;
    // (the local header's own name and extra may differ in length from the directory's)
    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
    const data = b.subarray(start, start + size);
    if (method === 0) out.push({ name, data });
    else if (method === 8) out.push({ name, data: await inflate(data) });
    else throw new Error(`${name}: compressed in a way notex can't read`);
  }
  return out;
}
