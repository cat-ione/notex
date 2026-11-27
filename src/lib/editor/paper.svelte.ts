// The note on paper: laying it out as it will be printed, and making the PDF (written by the
// Windows app, or in the browser sheet by sheet). Part of the Editor (see editor.svelte.ts).

import { flushSync, tick } from 'svelte';
import { parseInline } from '../markdown';
import * as F from '../files';
import { hexColour, pdfOf, type PdfLink, type PdfRun } from '../pdf';
import { wall } from '../tables';
import * as C from '../config';
import { toLatex } from '../math/latex';
import { block, isRefItem } from '../model';
import type { Editor } from '../editor.svelte';
import { plainText, round } from '../editor.svelte';

export class Paper {
  constructor(private ed: Editor) {}

  /** Laid out for paper (see beginPrint); the screen shows a veil meanwhile. */
  printing = $state(false);
  /**
   * The PDF being made here, sheet by sheet (see PdfProgress.svelte): how many sheets, which
   * are being drawn, a small picture of each one done; the paper's shape (width over height),
   * its margin (a share of its width) and its colour; the screen's theme (`theme`: its colours,
   * as they were before the page took the PDF's).
   */
  pdfMaking = $state<{ count: number; drawing: number[]; pictures: string[]; paper: number; margin: number; bg: string; theme: string } | null>(null);
  /** Esc while the PDF is made: stop making it. */
  pdfCancel = false;

  private endPrinting: (() => void) | null = null;

  /**
   * Lay the note out as it will be printed: the paper's text width, the PDF theme and every
   * drawing placed. A block that would straddle a page break starts the next page instead
   * (the browser would move its lines there, but not the drawings measured here).
   */
  beginPrint() {
    if (this.endPrinting || !this.ed.page) return;
    const page = this.ed.page;
    const c = this.ed.config;
    const paper = C.PAPERS[c.pdf.paper] ?? C.PAPERS.A4;
    const height = (paper.h - 2 * C.PAPER_MARGIN) * 96;
    const theme = C.allThemes(c).includes(c.pdf.theme) ? c.pdf.theme : c.theme;
    const pageWidth = Math.floor((paper.w - 2 * C.PAPER_MARGIN) * 96);
    C.applyConfig({ ...c, theme, pageWidth });
    const root = document.documentElement;
    root.classList.add('nx-print');
    // the theme's background over the whole sheet, margins too
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    C.applyConfig({ ...c, theme, pageWidth }, `@page { size: ${paper.w}in ${paper.h}in; margin: ${C.PAPER_MARGIN}in; background: ${bg}; }`);
    const cull = this.ed.pageLayout.cullScreens;
    this.ed.pageLayout.cullScreens = Infinity;
    this.printing = true;
    // the room made for notes, settled afresh for paper (from none: settling from the screen's
    // room, a pixel either way counting as settled, would come out a little differently each time)
    const screenRoom = this.ed.room;
    this.ed.setRoom({});
    const settle = () => {
      // notes placed properly at once (not provisionally, as while typing), and room made
      // for them, which changes heights and moves drawings further down: till that stops
      // (a later pass, as the screen leaves for after a tick, would change the sheets as
      // they're drawn)
      this.ed.pageLayout.quickLabels = false;
      try {
        for (let i = 0; i < 12; i++) {
          const room = JSON.stringify(this.ed.room);
          this.ed.spacerPasses = 0;
          flushSync();
          this.ed.pageLayout.relayoutAll();
          flushSync();
          if (i >= 2 && JSON.stringify(this.ed.room) === room) break;
        }
      } finally {
        this.ed.pageLayout.quickLabels = true;
        clearTimeout(this.ed.pageLayout.settleTimer);
      }
    };
    settle();
    // A block that would straddle a page break gets a spacer before it, up to the break.
    // (Not a margin: margins at a break are dropped in print.)
    const els = [...page.children].filter((e): e is HTMLElement => e.classList.contains('block'));
    let spacers: HTMLElement[] = [];
    for (let round = 0; round < 2; round++) {
      spacers.forEach((x) => x.remove());
      spacers = [];
      const top = page.getBoundingClientRect().top;
      for (const e of els) {
        // (a formula's limits can reach out of its block's box and its own, and glyphs a little beyond theirs)
        const rs = [e, ...e.querySelectorAll('.math'), ...e.querySelectorAll('.math.display .katex-html span')]
          .map((x) => x.getBoundingClientRect())
          .filter((r) => r.height > 0);
        const t = Math.max(0, Math.min(e.getBoundingClientRect().top - parseFloat(getComputedStyle(e).marginTop), ...rs.map((r) => r.top - 6)) - top);
        const b = Math.max(...rs.map((r) => r.bottom)) - top;
        if (b - t > height || Math.floor(t / height) === Math.floor((b - 1) / height)) continue;
        const sp = document.createElement('div');
        sp.className = 'nx-page-push';
        sp.style.height = `${Math.ceil(t / height) * height - t}px`;
        e.before(sp);
        spacers.push(sp);
      }
      settle();
    }
    this.endPrinting = () => {
      spacers.forEach((x) => x.remove());
      this.ed.setRoom(screenRoom);
      root.classList.remove('nx-print');
      this.ed.pageLayout.cullScreens = cull;
      C.applyConfig(this.ed.config);
      this.printing = false;
      tick().then(() => this.ed.pageLayout.relayoutAll());
    };
  }

  endPrint() {
    this.endPrinting?.();
    this.endPrinting = null;
  }

  /**
   * Save the note as a PDF file, laid out for paper: on Windows' app, by the system straight to
   * the file; elsewhere (the browser, the app on other systems) made here, each sheet drawn.
   */
  async exportPdf() {
    if (!F.canSavePdf()) return this.pdfInBrowser();
    const path = await F.choosePdfPath(this.ed.file.path ?? this.ed.file.name);
    if (!path) return;
    this.beginPrint();
    try {
      await F.savePdf(path, C.PAPERS[this.ed.config.pdf.paper] ?? C.PAPERS.A4, C.PAPER_MARGIN);
      this.ed.flash(`saved ${path.split(/[\\/]/).pop()}`);
    } catch (e) {
      this.ed.flash(`could not save the PDF: ${e}`);
    } finally {
      this.endPrint();
    }
  }

  /**
   * The note's text as laid out for paper, for the PDF to have real text over its pictures
   * (selectable, searchable): a run for each line of each block (page coordinates, CSS px;
   * a formula its LaTeX, in $…$, as copying gives it), each drawing's note; and its links, web
   * addresses to open and references to go to (the y of what they refer to).
   */
  private paperText(): { runs: PdfRun[]; links: PdfLink[] } {
    const runs: PdfRun[] = [], links: PdfLink[] = [];
    const page = this.ed.page;
    if (!page) return { runs, links };
    const o = page.getBoundingClientRect();
    const rel = (r: DOMRect) => ({ x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height });
    const size = (el: Element) => parseFloat(getComputedStyle(el).fontSize) || 16;
    return this.ed.withFrame(() => {
      this.ed.doc.blocks.forEach((blk, b) => {
        let run: PdfRun | null = null;
        const flush = () => {
          if (run && run.text.trim()) runs.push(run);
          run = null;
        };
        // where each item is (nothing for what isn't shown: a marker, a table's wall)
        const boxes = blk.items.map((it) => {
          const el = this.ed.el(it.id, b);
          const r = el?.getBoundingClientRect();
          return el && r && (r.width || r.height) && !(it.t === 'c' && it.cell) ? { el, r } : null;
        });
        blk.items.forEach((it, i) => {
          const at = boxes[i];
          if (!at) return flush();
          const q = rel(at.r);
          if (it.t === 'm') {
            flush();
            // (a display formula's box is the whole line: where its ink is, rather)
            const ink = it.display ? [...at.el.querySelectorAll('.katex-html > .katex-base, .katex-html > .base')].map((e) => e.getBoundingClientRect()).filter((r) => r.width) : [];
            const box = ink.length
              ? (() => {
                  const l = Math.min(...ink.map((r) => r.left)), t = Math.min(...ink.map((r) => r.top));
                  return rel(new DOMRect(l, t, Math.max(...ink.map((r) => r.right)) - l, Math.max(...ink.map((r) => r.bottom)) - t));
                })()
              : q;
            runs.push({ ...box, size: size(at.el), text: isRefItem(it) ? it.root[0].v : `$${toLatex(it.root)}$` });
            // its number, (1)
            const eqn = at.el.querySelector('.eqn');
            if (eqn?.textContent) runs.push({ ...rel(eqn.getBoundingClientRect()), size: size(eqn), text: eqn.textContent });
            return;
          }
          const sz = size(at.el);
          // (on the run's line, after it: the same run; else a new one)
          if (run && Math.abs(q.y - run.y) < 3 && q.x >= run.x + run.w - 2 && sz === run.size) {
            run.text += it.ch;
            run.xs!.push(q.x);
            run.w = q.x + q.w - run.x;
            run.h = Math.max(run.h, q.h);
          } else {
            flush();
            run = { ...q, size: sz, text: it.ch, xs: [q.x] };
          }
        });
        flush();
        // web addresses, a box over each line of one (not [[a note]]: there's nowhere to go)
        if (blk.kind !== 'code' && blk.kind !== 'fence')
          for (const l of parseInline(plainText(blk.items)).links) {
            if (l.note) continue;
            const lines: PdfLink[] = [];
            for (let i = l.start; i < l.end; i++) {
              const at = boxes[i];
              if (!at) continue;
              const q = rel(at.r), line = lines.find((x) => Math.abs(x.y - q.y) < 3);
              if (line) line.w = Math.max(line.w, q.x + q.w - line.x);
              else lines.push({ ...q, url: l.to });
            }
            links.push(...lines);
          }
        // references: to what they refer to
        blk.items.forEach((it, i) => {
          if (!isRefItem(it) || !boxes[i]) return;
          const target = this.ed.el(it.root[0].ref!);
          if (target) links.push({ ...rel(boxes[i]!.r), to: rel(target.getBoundingClientRect()).y });
        });
      });
      // the notes on drawings, as they're written
      for (const el of page.querySelectorAll<HTMLElement>('.dlabel[data-id]')) {
        const d = this.ed.drawing(el.dataset.id!);
        const r = el.getBoundingClientRect();
        if (d?.label && (r.width || r.height)) runs.push({ ...rel(r), size: size(el), text: d.label.replace(/\s+/g, ' ') });
      }
      return { runs, links };
    });
  }

  /** The PDF made here: laid out for paper, each sheet drawn into a page of it. */
  private async pdfInBrowser() {
    const name = this.ed.file.name.replace(/\.[^.]+$/, '') || 'note';
    let save: ((b: Blob) => Promise<string>) | null;
    if (F.isDesktop()) {
      const path = await F.choosePdfPath(this.ed.file.path ?? this.ed.file.name);
      save = path ? async (b) => (await F.writeBytes(path, b), path.split(/[\\/]/).pop()!) : null;
    } else save = await F.browserSaveTarget(name, 'pdf', 'PDF', 'application/pdf');
    if (!save || !this.ed.page) return;
    // (the screen's colours, for showing it being made: the page takes the PDF's theme)
    const cs = getComputedStyle(document.documentElement);
    const theme = ['--bg', '--fg', '--muted', '--accent', '--panel', '--border', '--scrim'].map((v) => `${v}: ${cs.getPropertyValue(v).trim()}`).join('; ');
    this.beginPrint();
    this.pdfCancel = false;
    try {
      const paper = C.PAPERS[this.ed.config.pdf.paper] ?? C.PAPERS.A4;
      const bg = hexColour(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff');
      const making = (this.pdfMaking = { count: 0, drawing: [], pictures: [], paper: paper.w / paper.h, margin: C.PAPER_MARGIN / paper.w, bg, theme });
      const blob = await pdfOf(
        this.ed.page,
        { w: paper.w, h: paper.h, margin: C.PAPER_MARGIN, textHeight: (paper.h - 2 * C.PAPER_MARGIN) * 96, bg },
        {
          progress: (p) => {
            const m = this.pdfMaking ?? making;
            if ('count' in p) m.count = p.count;
            else if ('drawing' in p) m.drawing = p.drawing;
            else m.pictures[p.done] = p.picture;
          },
          cancelled: () => this.pdfCancel,
          text: this.paperText(),
        },
      );
      const name = await save(blob);
      // (every sheet in view a moment, done)
      if (this.pdfMaking) this.pdfMaking.drawing = [];
      await new Promise((r) => setTimeout(r, 400));
      this.ed.flash(`saved ${name}`);
    } catch (e) {
      this.ed.flash((e as DOMException)?.name === 'AbortError' ? 'PDF cancelled' : `could not make the PDF: ${e}`);
    } finally {
      this.pdfMaking = null;
      this.endPrint();
    }
  }
}
