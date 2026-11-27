import { describe, expect, it } from 'vitest';
import { crc32, unzip, zip } from './zip';

const enc = new TextEncoder(), dec = new TextDecoder();

describe('zip', () => {
  it('reads back what it writes, names in any script', async () => {
    const files = [
      { name: 'Gruppen über ℤ.ntx', data: enc.encode('{"format":"notex"}') },
      { name: 'empty.ntx', data: new Uint8Array() },
    ];
    const back = await unzip(zip(files));
    expect(back.map((f) => [f.name, dec.decode(f.data)])).toEqual([
      ['Gruppen über ℤ.ntx', '{"format":"notex"}'],
      ['empty.ntx', ''],
    ]);
  });

  it('checksums as zip does', () => {
    expect(crc32(enc.encode('123456789')).toString(16)).toBe('cbf43926');
  });

  it('reads deflated files, as other programs write them', async () => {
    const text = 'a note '.repeat(50);
    const packed = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    // a stored zip of one file, then made deflated by hand
    const z = zip([{ name: 'a.ntx', data: new Uint8Array(packed) }]);
    const v = new DataView(z.buffer);
    v.setUint16(8, 8, true); // (local header: deflated)
    const dir = z.length - 22 - (46 + 5);
    v.setUint16(dir + 10, 8, true);
    v.setUint32(dir + 24, text.length, true);
    const [f] = await unzip(z);
    expect(dec.decode(f.data)).toBe(text);
  });

  it('says when a file is not a zip', async () => {
    await expect(unzip(enc.encode('not a zip at all, just some text here'))).rejects.toThrow('not a zip file');
  });
});
