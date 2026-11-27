// Reading back a PDF the app made: its pages (their size, where the picture of the sheet is
// on each) and the picture's pixels, decoded in the page (jsPDF stores each as a deflated,
// PNG-predicted RGB image), so a test can look at what is where on paper.
import type { Page } from '@playwright/test';

/**
 * A page of the PDF: its size and the picture's place on it (points), the picture's size
 * (pixels), the colour the page is filled with first (0 to 255, under the picture: the margins).
 */
export type PdfPage = { box: number[]; at: number[]; w: number; h: number; fill: number[] | null };

/**
 * The PDF in `window.__blob`, read: its pages, and each page's picture kept in the page as
 * `window.__sheets[i]` (an ImageData) for `sample`.
 */
export function readPdf(page: Page): Promise<PdfPage[]> {
  return page.evaluate(async () => {
    const bytes = new Uint8Array(await (window as any).__blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    // every object: where its dictionary and its stream are
    const objs = new Map<number, { dict: string; data?: Uint8Array }>();
    const re = /(\d+) 0 obj\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const end = text.indexOf('endobj', re.lastIndex);
      const body = text.slice(re.lastIndex, end);
      const s = body.search(/stream\r?\n/);
      if (s < 0) objs.set(+m[1], { dict: body });
      else {
        const dict = body.slice(0, s);
        const len = +/\/Length (\d+)/.exec(dict)![1];
        const from = re.lastIndex + s + body.slice(s).indexOf('\n') + 1;
        objs.set(+m[1], { dict, data: bytes.subarray(from, from + len) });
      }
      re.lastIndex = end;
    }
    const inflate = async (data: Uint8Array) =>
      new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    const ref = (s: string, key: string) => +new RegExp(`/${key} (\\d+) 0 R`).exec(s)![1];
    const nums = (s: string) => s.trim().split(/\s+/).map(Number);
    // the pages, in order
    const kids = /\/Kids \[([^\]]*)\]/.exec([...objs.values()].find((o) => /\/Type \/Pages/.test(o.dict))!.dict)![1];
    const pages = [...kids.matchAll(/(\d+) 0 R/g)].map((k) => objs.get(+k[1])!.dict);
    const sheets: ImageData[] = [];
    const out = [];
    for (const pg of pages) {
      const box = nums(/\/MediaBox \[([^\]]*)\]/.exec(pg)![1]);
      const contents = objs.get(ref(pg, 'Contents'))!;
      const ops = new TextDecoder('latin1').decode(/FlateDecode/.test(contents.dict) ? await inflate(contents.data!) : contents.data!);
      // the picture: `w 0 0 h x y cm /Name Do` (one per page)
      const draw = /([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+) cm\s*\/(\S+) Do/.exec(ops)!;
      const [w, h, x, y] = draw.slice(1, 5).map(Number);
      const res = objs.get(ref(pg, 'Resources'))!.dict;
      const xobjs = /\/XObject <<([^>]*)>>/.exec(res)![1];
      const img = objs.get(+new RegExp(`/${draw[5]} (\\d+) 0 R`).exec(xobjs)![1])!;
      const iw = +/\/Width (\d+)/.exec(img.dict)![1], ih = +/\/Height (\d+)/.exec(img.dict)![1];
      const raw = await inflate(img.data!);
      // undo the PNG predictors: each row starts with its filter's number
      const rgb = new Uint8Array(iw * ih * 3), row = iw * 3;
      for (let r = 0; r < ih; r++) {
        const f = raw[r * (row + 1)], src = r * (row + 1) + 1, dst = r * row;
        for (let i = 0; i < row; i++) {
          const a = i >= 3 ? rgb[dst + i - 3] : 0, b = r ? rgb[dst - row + i] : 0, c = r && i >= 3 ? rgb[dst - row + i - 3] : 0;
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
          rgb[dst + i] = (raw[src + i] + pred) & 255;
        }
      }
      const data = new ImageData(iw, ih);
      for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) (data.data[j] = rgb[i]), (data.data[j + 1] = rgb[i + 1]), (data.data[j + 2] = rgb[i + 2]), (data.data[j + 3] = 255);
      sheets.push(data);
      // (PDF's y goes up: the picture's top, from the page's top)
      const rg = /([\d.]+) ([\d.]+) ([\d.]+) rg/.exec(ops);
      out.push({ box, at: [x, box[3] - y - h, w, h], w: iw, h: ih, fill: rg ? rg.slice(1, 4).map((v) => Math.round(+v * 255)) : null });
    }
    (window as any).__sheets = sheets;
    return out;
  });
}

/**
 * The note as the screen shows it laid out for paper (Editor.beginPrint), screenshotted whole
 * and kept in the page as `window.__paper` (an ImageData, `ratio` pixels per CSS pixel: the
 * page's own device pixel ratio, which must be the PDF's). The window is made as tall as the
 * note for it (and left so: make the PDF in the same window), and the veil over it hidden.
 */
export async function paperPicture(page: Page) {
  const size = page.viewportSize()!;
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  const h = await page.evaluate(() => document.querySelector('.page')!.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.ceil(h) + 300 });
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
  // (the window resized: its own layout done first)
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  const veil = await page.addStyleTag({ content: '.veil { display: none !important; }' });
  const box = await page.evaluate(() => {
    const pg = document.querySelector('.page')!;
    pg.parentElement!.scrollTop = 0;
    const r = pg.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: pg.scrollHeight };
  });
  await page.waitForTimeout(100);
  const png = await page.screenshot({ clip: box });
  await veil.evaluate((s) => (s as Element).remove());
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
  await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
    c.drawImage(bmp, 0, 0);
    (window as any).__paper = c.getImageData(0, 0, bmp.width, bmp.height);
  }, png.toString('base64'));
}

/**
 * How sheet `i`'s picture in the PDF differs from that part of the screenshot (paperPicture),
 * in bands `band` CSS pixels tall. Text is drawn a little lighter in the PDF (through an
 * image), so not pixel for pixel; for each band:
 *
 * - `ink`: the most, of the band's cells 40 CSS pixels wide, any has of its clearly inked
 *   pixels with nothing inked near them (within `slack` pixels) in the other picture, either
 *   way round: text or a line moved, missing or extra (a thin one too);
 * - `tone`: the most any cell 4 CSS pixels square differs in its average colour (0 to 765),
 *   leaving out what's inked in either picture (text, lines): a fill (a highlight, a box's
 *   tint) moved or in another colour.
 */
export function differences(page: Page, i: number, sheetHeight: number, ratio = 2.5, band = 10, slack = 5) {
  return page.evaluate(
    ({ i, ph, ratio, band, slack }) => {
      const s: ImageData = (window as any).__sheets[i], p: ImageData = (window as any).__paper;
      const from = Math.round(i * ph * ratio);
      const w = Math.min(s.width, p.width), rows = Math.min(s.height, p.height - from);
      // (row y of the sheet is row from + y of the screenshot)
      const pics = [{ img: s, top: 0 }, { img: p, top: from }];
      const bg = (() => {
        // (the sheet's commonest colour: its first pixel may be a box's or a highlight's, where
        // a page break falls in one)
        const seen = new Map<number, number>();
        for (let k = 0; k < s.data.length; k += 4 * 7) {
          const c = (s.data[k] << 16) | (s.data[k + 1] << 8) | s.data[k + 2];
          seen.set(c, (seen.get(c) ?? 0) + 1);
        }
        const c = [...seen].sort((a, b) => b[1] - a[1])[0][0];
        return [c >> 16, (c >> 8) & 255, c & 255];
      })();
      const px = (k: number, x: number, y: number) => {
        const { img, top } = pics[k], j = ((top + y) * img.width + x) * 4;
        return [img.data[j], img.data[j + 1], img.data[j + 2]];
      };
      const dist = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      // how inked each pixel is (its distance from the background), each picture
      const inked = pics.map((_, k) => {
        const v = new Uint16Array(w * rows);
        for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) v[y * w + x] = dist(px(k, x, y), bg);
        return v;
      });
      const lonely = (a: number, x: number, y: number) => {
        const other = inked[1 - a];
        for (let yy = Math.max(0, y - slack); yy <= Math.min(rows - 1, y + slack); yy++)
          for (let xx = Math.max(0, x - slack); xx <= Math.min(w - 1, x + slack); xx++) if (other[yy * w + xx] > 50) return false;
        return true;
      };
      const bh = Math.round(band * ratio), cell = Math.round(4 * ratio);
      const ink: number[] = [], tone: number[] = [];
      for (let y0 = 0; y0 < rows; y0 += bh) {
        const y1 = Math.min(rows, y0 + bh);
        const cw = Math.round(40 * ratio);
        let most = 0;
        for (let x0 = 0; x0 < w; x0 += cw) {
          let off = 0, n = 0;
          for (let y = y0; y < y1; y++)
            for (let x = x0; x < Math.min(w, x0 + cw); x++)
              for (let a = 0; a < 2; a++)
                if (inked[a][y * w + x] > 120) {
                  n++;
                  if (lonely(a, x, y)) off++;
                }
          // (a few stray pixels say nothing)
          if (n >= 40) most = Math.max(most, off / n);
        }
        ink.push(most);
        let worst = 0;
        for (let cy = y0; cy < y1; cy += cell)
          for (let cx = 0; cx < w; cx += cell) {
            const sum = [[0, 0, 0], [0, 0, 0]];
            let m = 0;
            for (let y = cy; y < Math.min(y1, cy + cell); y++)
              for (let x = cx; x < Math.min(w, cx + cell); x++) {
                if (inked[0][y * w + x] > 120 || inked[1][y * w + x] > 120) continue;
                m++;
                for (let k = 0; k < 2; k++) {
                  const c = px(k, x, y);
                  sum[k][0] += c[0], sum[k][1] += c[1], sum[k][2] += c[2];
                }
              }
            // (a cell mostly ink says nothing about fills)
            if (m > cell * cell * 0.5) worst = Math.max(worst, dist(sum[0], sum[1]) / m);
          }
        tone.push(worst);
      }
      return { ink, tone, rows, sheetRows: s.height, paperRows: p.height - from };
    },
    { i, ph: sheetHeight, ratio, band, slack },
  );
}

/**
 * The colours in a rectangle of sheet `i`'s picture, given in the paper layout's CSS pixels
 * from the sheet's top left: how much of it is ink (not the background `bg`, the sheet's
 * commonest colour), and its
 * commonest colour that isn't the background.
 */
export function sample(page: Page, i: number, r: { x: number; y: number; w: number; h: number }, ratio = 2.5) {
  return page.evaluate(
    ({ i, r, ratio }) => {
      const s: ImageData = (window as any).__sheets[i];
      const x0 = Math.max(0, Math.round(r.x * ratio)), y0 = Math.max(0, Math.round(r.y * ratio));
      const x1 = Math.min(s.width, Math.round((r.x + r.w) * ratio)), y1 = Math.min(s.height, Math.round((r.y + r.h) * ratio));
      const bg = (() => {
        // (the sheet's commonest colour: its first pixel may be a box's or a highlight's, where
        // a page break falls in one)
        const seen = new Map<number, number>();
        for (let k = 0; k < s.data.length; k += 4 * 7) {
          const c = (s.data[k] << 16) | (s.data[k + 1] << 8) | s.data[k + 2];
          seen.set(c, (seen.get(c) ?? 0) + 1);
        }
        const c = [...seen].sort((a, b) => b[1] - a[1])[0][0];
        return [c >> 16, (c >> 8) & 255, c & 255];
      })();
      let ink = 0, n = 0;
      const seen = new Map<string, number>();
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const k = (y * s.width + x) * 4;
          const c = [s.data[k], s.data[k + 1], s.data[k + 2]];
          n++;
          if (Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > 24) {
            ink++;
            const key = c.map((v) => v >> 3 << 3).join(',');
            seen.set(key, (seen.get(key) ?? 0) + 1);
          }
        }
      const top = [...seen].sort((a, b) => b[1] - a[1])[0];
      return { ink: n ? ink / n : 0, colour: top ? top[0].split(',').map(Number) : null, bg };
    },
    { i, r, ratio },
  );
}

/** A piece of the PDF's text: where it starts (points, from the page's top left), its size, whether it's drawn. */
export type PdfText = { x: number; y: number; size: number; text: string; invisible: boolean };
/** A link on a page: its box (points, from the top left: x0, y0, x1, y1), the address it opens or the page (from 0) it goes to. */
export type PdfLinkBox = { rect: number[]; url?: string; page?: number };

/** The text and links of each page of the PDF in `window.__blob`. */
export function readPdfText(page: Page): Promise<{ text: PdfText[]; links: PdfLinkBox[] }[]> {
  return page.evaluate(async () => {
    const bytes = new Uint8Array(await (window as any).__blob.arrayBuffer());
    const src = new TextDecoder('latin1').decode(bytes);
    const objs = new Map<number, { dict: string; data?: Uint8Array }>();
    const re = /(\d+) 0 obj\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const end = src.indexOf('endobj', re.lastIndex);
      const body = src.slice(re.lastIndex, end);
      const s = body.search(/stream\r?\n/);
      if (s < 0) objs.set(+m[1], { dict: body });
      else {
        const dict = body.slice(0, s);
        const len = +/\/Length (\d+)/.exec(dict)![1];
        const from = re.lastIndex + s + body.slice(s).indexOf('\n') + 1;
        objs.set(+m[1], { dict, data: bytes.subarray(from, from + len) });
      }
      re.lastIndex = end;
    }
    const inflate = async (o: { dict: string; data?: Uint8Array }) => {
      const raw = /FlateDecode/.test(o.dict) ? new Uint8Array(await new Response(new Blob([o.data! as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()) : o.data!;
      return new TextDecoder('latin1').decode(raw);
    };
    const ref = (s: string, key: string) => +new RegExp(`/${key} (\\d+) 0 R`).exec(s)![1];
    const kids = [.../\/Kids \[([^\]]*)\]/.exec([...objs.values()].find((o) => /\/Type \/Pages/.test(o.dict))!.dict)![1].matchAll(/(\d+) 0 R/g)].map((k) => +k[1]);
    // how each font's codes read: WinAnsi bytes, or glyph numbers through its ToUnicode map
    const WIN = '€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f\x90‘’“”•–—˜™š›œ\x9džŸ';
    const fonts = new Map<number, (code: string, hex: boolean) => string>();
    const fontOf = async (n: number) => {
      if (fonts.has(n)) return fonts.get(n)!;
      const d = objs.get(n)!.dict;
      let read: (code: string, hex: boolean) => string;
      if (/\/ToUnicode/.test(d)) {
        const map = new Map<string, string>();
        const cmap = await inflate(objs.get(ref(d, 'ToUnicode'))!);
        for (const b of cmap.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g))
          map.set(b[1].toLowerCase().padStart(4, '0'), String.fromCodePoint(...(b[2].match(/.{4}/g) ?? []).map((h) => parseInt(h, 16))));
        read = (code) => (code.match(/.{4}/g) ?? []).map((g) => map.get(g.toLowerCase()) ?? '�').join('');
      } else read = (code) => [...code].map((c) => (c.charCodeAt(0) >= 0x80 && c.charCodeAt(0) < 0xa0 ? WIN[c.charCodeAt(0) - 0x80] : c)).join('');
      fonts.set(n, read);
      return read;
    };
    const unescape = (s: string) => s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[e] ?? (/\d/.test(e) ? String.fromCharCode(parseInt(e, 8)) : e));
    const out = [];
    for (const k of kids) {
      const pg = objs.get(k)!.dict;
      const box = /\/MediaBox \[([^\]]*)\]/.exec(pg)![1].trim().split(/\s+/).map(Number);
      const res = objs.get(ref(pg, 'Resources'))!.dict;
      const fontRefs = new Map([...(/\/Font <<([^>]*)>>/.exec(res)?.[1] ?? '').matchAll(/\/(\S+) (\d+) 0 R/g)].map((f) => [f[1], +f[2]]));
      const ops = await inflate(objs.get(ref(pg, 'Contents'))!);
      const text: any[] = [];
      for (const t of ops.matchAll(/BT([\s\S]*?)ET/g)) {
        const body = t[1];
        const tf = /\/(\S+) ([\d.]+) Tf/.exec(body), td = /([-\d.]+) ([-\d.]+) Td/.exec(body);
        if (!tf || !td) continue;
        const read = await fontOf(fontRefs.get(tf[1])!);
        let s = '';
        for (const piece of body.matchAll(/\((?:\\.|[^\\)])*\)|<[0-9a-fA-F]*>/g)) {
          const p = piece[0];
          s += p.startsWith('(') ? read(unescape(p.slice(1, -1)), false) : read(p.slice(1, -1), true);
        }
        text.push({ x: +td[1], y: box[3] - +td[2], size: +tf[2], text: s, invisible: /\b3 Tr/.test(body) });
      }
      const links: any[] = [];
      // (written in the page's own dictionary, or as objects of their own)
      const annots = (/\/Annots \[\n([\s\S]*?)\n\]/.exec(pg) ?? /\/Annots \[([^\]]*)\]/.exec(pg))?.[1] ?? '';
      const dicts = annots.includes('<<') ? annots.split(/(?=<<\s*\/Type \/Annot)/).filter((d) => d.includes('/Annot')) : [...annots.matchAll(/(\d+) 0 R/g)].map((a) => objs.get(+a[1])!.dict);
      for (const d of dicts) {
        if (!/\/Subtype \/Link/.test(d)) continue;
        const q = /\/Rect \[([^\]]*)\]/.exec(d)![1].trim().split(/\s+/).map(Number);
        // (either corner first)
        const r = [Math.min(q[0], q[2]), Math.min(q[1], q[3]), Math.max(q[0], q[2]), Math.max(q[1], q[3])];
        const url = /\/URI \(((?:\\.|[^\\)])*)\)/.exec(d)?.[1];
        const dest = /\/Dest \[(\d+) 0 R/.exec(d)?.[1];
        links.push({ rect: [r[0], box[3] - r[3], r[2], box[3] - r[1]], url: url && unescape(url), page: dest ? kids.indexOf(+dest) : undefined });
      }
      out.push({ text, links });
    }
    return out;
  });
}
