// The command palette (\ or ctrl+k): what it lists for each context (math, text, drawing,
// a drawing's actions, what to refer to), finding by name or group word, and running a
// command. Part of the Editor (see editor.svelte.ts); what's open is ed.palette.

import { tick } from 'svelte';
import { MARK_KINDS } from '../marks';
import { rank } from '../match';
import * as U from '../usage';
import { docToLatex } from '../export';
import { docToMarkdown } from '../mdfile';
import { headingOf } from '../markdown';
import * as F from '../files';
import { zip } from '../zip';
import * as C from '../config';
import * as M from '../math/edit';
import { MATH_PALETTE } from '../math/defs';
import { parseLatex } from '../math/parse';
import { block, BOX_KINDS, ch, chars, cmd, isFigure, math, sym, type BlockKind, type Doc } from '../model';
import type { Editor, PaletteEntry, PaletteCtx, PaletteItem } from '../editor.svelte';
import { MATH_COMMON, MATH_WRAP, TABLE_ACTIONS, MATRIX_ACTIONS, SIZED, plainText, keyLabel, describeInserter, TAGS, BOX_DESC, MARK_DESC } from '../editor.svelte';

export class Palette {
  constructor(private ed: Editor) {}

  // ── palette ──

  get paletteItems(): PaletteItem[] {
    const p = this.ed.palette;
    if (!p) return [];
    const q = p.query;
    // what's been picked most (and lately) in this palette first, unless that's switched off
    const remember = this.ed.config.rememberCommands;
    const use = (n: string) => (remember ? U.score(p.ctx, n) : 0);
    const order = (names: string[]) => (remember ? U.byUse(p.ctx, names) : names);
    // (as typed: by name, forgiving a typo, or by a word of what it does)
    const find = (names: string[], desc?: (n: string) => string) => (q ? rank(names, q, use, desc) : order(names));
    const draws = this.drawCommands();
    const rankDraws = () => find(draws.map((c) => c.name), (n) => `${draws.find((c) => c.name === n)!.desc} draw drawing shape`).map((n) => draws.find((c) => c.name === n)!);
    if (p.ctx === 'draw') return rankDraws();
    if (p.ctx === 'ref') {
      const ts = this.ed.refTargets();
      // (in the note's order, nothing typed: not by use, which says little about what to refer to)
      return (q ? rank(ts.map((t) => t.name), q, () => 0, (n) => ts.find((t) => t.name === n)!.desc) : ts.map((t) => t.name)).map((n) => ({ name: n, desc: ts.find((t) => t.name === n)!.desc }));
    }
    if (p.ctx === 'style') {
      const acts = this.ed.styling ? this.ed.drawings.drawingActions(this.ed.styling).filter((a) => !a.keyOnly) : [];
      return find(acts.map((c) => c.name), (n) => acts.find((c) => c.name === n)!.desc).map((n) => {
        const c = acts.find((c) => c.name === n)!;
        return { name: c.name, desc: `${c.desc}  ${keyLabel(c.keys[0])}` };
      });
    }
    if (p.ctx === 'math') {
      const user = this.ed.config.snippets.math;
      const names = [...new Set([...Object.keys(user), ...Object.keys(MATH_PALETTE)])];
      // Drawing commands join in once something is typed, after the math ones (a math command of the same name wins).
      const extra = q ? rankDraws().filter((d) => !names.includes(d.name)) : [];
      // nothing typed yet: the likeliest first (what wraps a selection, with one)
      const first = this.ed.mathSelRange ? MATH_WRAP : MATH_COMMON;
      const listed = q ? names : [...first.filter((n) => names.includes(n)), ...names.filter((n) => !first.includes(n) && !SIZED.test(n))];
      const math = find(listed).map((n) => ({ name: n, desc: user[n] !== undefined ? user[n] : describeInserter(n) }));
      // in a matrix: its rows and columns first
      const grid = this.ed.mathItem && M.gridAt(this.ed.mathItem.root, this.ed.mc) ? MATRIX_ACTIONS : [];
      const gridItems = find(grid.map(([, n]) => n), (n) => grid.find(([, m]) => m === n)![2]).map((n) => ({ name: n, desc: grid.find(([, m]) => m === n)![2] }));
      return [...gridItems, ...math.filter((m) => !grid.some(([, n]) => n === m.name)), ...extra];
    }
    const cmds = this.textCommands();
    // what fits where the caret is comes first (as typed, an exact name still wins)
    const near = this.nearCommands();
    // (by its description, and the words of its group: draw finds every drawing command)
    const found = find(cmds.map((c) => c.name), (n) => {
      const c = cmds.find((c) => c.name === n)!;
      return `${c.desc} ${c.tags ?? ''} ${TAGS[c.name] ?? ''} ${c.draw ? 'draw drawing shape' : ''}`;
    });
    const listed = !near
      ? found
      : q
        ? [...found.filter((n) => n === q), ...found.filter((n) => n !== q && near.names.includes(n)), ...found.filter((n) => n !== q && !near.names.includes(n))]
        : [...order(near.names), ...found.filter((n) => !near.names.includes(n))];
    return listed.map((n, i) => {
      const c = cmds.find((c) => c.name === n)!;
      const item: PaletteItem = { name: c.name, desc: c.desc, draw: c.draw };
      // (a line under what fits)
      if (near && !q && i === near.names.length) item.rule = true;
      return item;
    });
  }

  /**
   * The commands that fit where the caret is, to offer first: a table's, a selection's
   * (styles, drawing on it), a list's, a heading's. (In math, the math palette does instead.)
   */
  nearCommands(): { names: string[] } | null {
    if (this.ed.tables.tableRow()) return { names: TABLE_ACTIONS.map((a) => a[1]) };
    if (this.ed.cmdSel ?? this.ed.selection) return { names: ['bold', 'italic', 'inlinecode', 'strikethrough', 'texthighlight', 'arrow', 'box', 'circle', 'highlight'] };
    const kind = this.ed.blk.kind;
    if (kind === 'li' || kind === 'ol') return { names: kind === 'li' ? ['ol', 'p'] : ['li', 'p'] };
    if (kind === 'h1' || kind === 'h2' || kind === 'h3') return { names: ['h1', 'h2', 'h3', 'p'].filter((k) => k !== kind) };
    return null;
  }

  openPalette(ctx: PaletteCtx) {
    this.ed.palette = { ctx, query: '', sel: 0 };
    this.ed.paletteAt = null;
    this.ed.setMode('palette');
  }

  /** Choose the palette's `i`th item (a click on it). */
  pickPalette(i: number) {
    if (this.ed.palette) this.acceptPalette(this.paletteItems[i]);
  }

  closePalette() {
    this.ed.palette = null;
    this.ed.mode = this.ed.prevMode;
  }

  paletteKey(k: string): boolean {
    const p = this.ed.palette!;
    const items = this.paletteItems;
    switch (k) {
      case 'Escape': this.closePalette(); return true;
      case 'Backspace':
        if (!p.query) this.closePalette();
        else { p.query = p.query.slice(0, -1); p.sel = 0; }
        return true;
      case 'Down': case 'C-n': case 'C-j': p.sel = Math.min(items.length - 1, p.sel + 1); return true;
      case 'Up': case 'C-p': case 'C-k': p.sel = Math.max(0, p.sel - 1); return true;
      case 'PageDown': p.sel = Math.min(items.length - 1, p.sel + 10); return true;
      case 'PageUp': p.sel = Math.max(0, p.sel - 10); return true;
      case 'Enter': case 'Tab': case ' ':
        // (what to refer to has spaces in its name: theorem 2)
        if (k === ' ' && p.ctx === 'ref') break;
        this.acceptPalette(items[p.sel]);
        return true;
    }
    if (k.length === 1) {
      if (p.ctx === 'math' && !p.query && !/[a-zA-Z]/.test(k)) {
        // `\,` `\;` `\{` … → raw single-char control sequences
        this.closePalette();
        this.ed.checkpoint();
        const item = this.ed.mathItem!;
        M.insertNode(item.root, this.ed.mc, sym('\\' + k));
        return true;
      }
      // (unless the name goes on with it: pmatrix3x3)
      const goesOn = (n: string) => n.startsWith(p.query + k);
      if (p.ctx === 'math' && p.query && !/[a-zA-Z]/.test(k) && !Object.keys(MATH_PALETTE).some(goesOn) && !Object.keys(this.ed.config.snippets.math).some(goesOn)) {
        // as in LaTeX, the name ends at the first non-letter: \int_0^1, \alpha^2, \sin(x)
        // (only the name as typed: an unknown one is a raw \name, not the closest suggestion)
        this.acceptPalette(undefined);
        if (k !== ' ') this.ed.menus.runKey(k);
        return true;
      }
      if (p.ctx === 'text' && !p.query && k === '\\') {
        this.closePalette();
        this.ed.checkpoint('type');
        this.ed.blk.items.splice(this.ed.o, 0, ch('\\'));
        this.ed.o++;
        return true;
      }
      p.query += k;
      p.sel = 0;
      return true;
    }
    return true;
  }

  acceptPalette(picked: PaletteItem | undefined) {
    const p = this.ed.palette!;
    const name = picked?.name;
    // an exact name as typed wins, unless another item was chosen (arrowed to, clicked)
    const q = picked && picked.name !== this.paletteItems[0]?.name ? picked.name : p.query;
    this.closePalette();
    // (remembered, to come first next time)
    const picks = (n: string) => this.ed.config.rememberCommands && U.used(p.ctx, n);
    if (p.ctx === 'ref') {
      const ts = this.ed.refTargets();
      const t = ts.find((t) => t.name === q) ?? ts.find((t) => t.name === name);
      if (t) this.ed.insertRef(t.id);
      else this.ed.flash(ts.length ? `nothing called ${q} to refer to` : 'nothing to refer to yet: number a display formula, or make a theorem');
      return;
    }
    if (p.ctx === 'style') {
      const acts = this.ed.styling ? this.ed.drawings.drawingActions(this.ed.styling) : [];
      const c = acts.find((c) => c.name === q) ?? acts.find((c) => c.name === name);
      if (c) picks(c.name), c.run();
      else if (q) this.ed.flash(`unknown action: ${q}`);
      return;
    }
    if (p.ctx === 'draw' || picked?.draw) {
      const draws = this.drawCommands();
      const c = (p.ctx === 'draw' && draws.find((c) => c.name === q)) || draws.find((c) => c.name === name);
      if (!c) return void (q && this.ed.flash(`unknown drawing: ${q}`));
      picks(c.name);
      this.ed.cmdSel = this.ed.selection;
      this.ed.anchor = null;
      c.run();
      this.ed.cmdSel = null;
      return;
    }
    if (p.ctx === 'math') {
      const item = this.ed.mathItem!;
      // a matrix's rows and columns
      const ga = this.ed.mathItem && M.gridAt(item.root, this.ed.mc) ? (MATRIX_ACTIONS.find(([, n]) => n === q) ?? MATRIX_ACTIONS.find(([, n]) => n === name)) : undefined;
      if (ga) return picks(ga[1]), this.ed.menus.matrixCommand(ga[0]);
      this.ed.checkpoint();
      // Exact names win over the highlighted suggestion; user snippets win over built-ins.
      const user = this.ed.config.snippets.math;
      const key = user[q] !== undefined || MATH_PALETTE[q] ? q : name;
      if (key && (user[key] !== undefined || MATH_PALETTE[key])) picks(key);
      const range = this.ed.mathSelRange;
      this.ed.msel = null;
      if (range) {
        // With a selection, a structural command wraps it (\sqrt, \hat, \frac…); anything else replaces it.
        const ins = key && user[key] === undefined ? MATH_PALETTE[key] : undefined;
        const node = ins && 'node' in ins ? ins.node() : null;
        if (node?.k === 'cmd' && node.slots.length) {
          M.wrapRange(item.root, this.ed.mc, range.s, range.e, node, node.name === 'root' ? 1 : ((ins as { enter?: number }).enter ?? 0));
          return;
        }
        M.takeRange(item.root, this.ed.mc, range.s, range.e);
      }
      M.settleAuto(item.root, this.ed.mc, '\\');
      this.ed.learned('sub-names');
      if (key && user[key] !== undefined) M.insertParsed(item.root, this.ed.mc, parseLatex(user[key]));
      else if (key && MATH_PALETTE[key]) M.applyInserter(item.root, this.ed.mc, MATH_PALETTE[key]);
      else if (q) M.insertNode(item.root, this.ed.mc, sym('\\' + q));
      return;
    }
    const c = this.textCommands().find((c) => c.name === (this.textCommands().some((c) => c.name === q) ? q : name));
    // Drawing commands act on the selection, if any, and styles and kinds on it; everything else drops it.
    this.ed.cmdSel = this.ed.selection;
    if (!c?.keep) this.ed.anchor = null;
    if (c) picks(c.name), c.run();
    else if (q) this.ed.flash(`unknown command: ${q}`);
    this.ed.cmdSel = null;
  }

  /** Commands available from `\` / `:` outside math. Intended to become user-extensible. */
  /** Drawing commands: in the text menu, the draw menu (Ctrl+D), and the math menu once you type. */
  drawCommands(): PaletteEntry[] {
    return [
      { name: 'arrow', desc: 'draw an arrow', run: () => this.ed.drawings.startArrow(), draw: true },
      ...MARK_KINDS.map((k) => ({ name: k, desc: MARK_DESC[k], run: () => this.ed.drawings.startMark(k), draw: true })),
      { name: 'drawings', desc: 'select a drawing', run: () => this.ed.selectDrawingByHint(), draw: true },
    ];
  }

  textCommands(): PaletteEntry[] {
    // (every paragraph the selection touches)
    // (every paragraph the selection touches; headings by their #s, code by fences around)
    const setKind = (kind: BlockKind) => () => {
      this.ed.checkpoint();
      const sel = this.ed.selection;
      const first = sel ? sel.s.b : this.ed.b, last = sel ? sel.e.b : this.ed.b;
      if (kind === 'code') {
        this.ed.doc.blocks.splice(last + 1, 0, block(chars('```')));
        this.ed.doc.blocks.splice(first, 0, block(chars('```')));
        this.ed.b++;
        if (this.ed.anchor) this.ed.anchor = { ...this.ed.anchor, b: this.ed.anchor.b + 1 };
        this.ed.derive(first, last + 2);
        return;
      }
      for (let b = first; b <= last; b++) {
        const blk = this.ed.doc.blocks[b];
        if (isFigure(blk.kind) || blk.kind === 'code' || blk.kind === 'fence') continue;
        const had = headingOf(plainText(blk.items))?.prefix ?? 0;
        const want = /^h[1-3]$/.test(kind) ? '#'.repeat(+kind[1]) + ' ' : '';
        blk.items.splice(0, had, ...chars(want));
        if (b === this.ed.b) this.ed.o = Math.max(0, this.ed.o - had + want.length);
        if (this.ed.anchor?.b === b) this.ed.anchor = { b, o: Math.max(0, this.ed.anchor.o - had + want.length) };
        blk.kind = kind === 'li' || kind === 'ol' ? kind : 'p';
        if (blk.kind !== 'li') delete blk.check;
        this.ed.forget(blk);
      }
      this.ed.derive(first, last);
    };
    return [
      ...this.drawCommands(),
      { name: 'math', desc: 'inline math', run: () => this.ed.insertMath(false) },
      { name: 'display', desc: 'display math block', run: () => this.ed.insertMath(true) },
      { name: 'h1', desc: 'heading 1', run: setKind('h1'), keep: true },
      { name: 'h2', desc: 'heading 2', run: setKind('h2'), keep: true },
      { name: 'h3', desc: 'heading 3', run: setKind('h3'), keep: true },
      { name: 'p', desc: 'paragraph', run: setKind('p'), keep: true },
      { name: 'li', desc: 'list item', run: setKind('li'), keep: true },
      { name: 'ol', desc: 'numbered list item', run: setKind('ol'), keep: true },
      { name: 'bold', desc: 'bold  ctrl+b', run: () => this.ed.toggleStyle('b'), keep: true },
      { name: 'italic', desc: 'italic  ctrl+i', run: () => this.ed.toggleStyle('i'), keep: true },
      { name: 'code', desc: 'code block  ```', run: setKind('code'), keep: true },
      { name: 'table', desc: 'insert a table (tab: next cell, enter: new row)', run: () => this.ed.tables.insertTable() },
      // (characters that typed would make something else)
      { name: 'dollar', desc: 'type a $ (not a formula)', run: () => this.ed.typeText('$') },
      { name: 'backslash', desc: 'type a \\ (not the palette)', run: () => this.ed.typeText('\\') },
      { name: 'diagram', desc: 'insert a diagram: boxes, arrows, pen  ctrl+shift+d in one', run: () => this.ed.sketch.insertDiagram() },
      { name: 'graph', desc: 'insert a graph of functions: y = sin x, a line each (g in a diagram)', run: () => this.ed.sketch.insertGraph() },
      { name: 'sketch', desc: `${this.ed.sketch.on?.kind === 'free' ? 'stop drawing' : 'draw'} on the note (a pen draws on it anyway)  ctrl+shift+d`, run: () => this.ed.sketch.toggleFree() },
      ...(this.ed.tables.tableRow() ? TABLE_ACTIONS.map(([what, name, desc]) => ({ name, desc, run: () => this.ed.tables.tableCommand(what), tags: 'table' })) : []),
      { name: 'image', desc: 'insert an image (or paste / drop one)', run: () => void this.ed.chooseImages() },
      { name: 'inlinecode', desc: 'inline code  ctrl+e', run: () => this.ed.toggleStyle('c'), keep: true },
      { name: 'strikethrough', desc: 'strike text out ~~…~~  ctrl+shift+x', run: () => this.ed.toggleStyle('s'), keep: true },
      { name: 'texthighlight', desc: 'highlight text ==…==  ctrl+shift+h', run: () => this.ed.toggleStyle('h'), keep: true },
      { name: 'todo', desc: 'a box to tick: [ ] at a line’s start  ctrl+enter ticks it', run: () => this.ed.toggleTasks(), keep: true },
      ...BOX_KINDS.map((k): PaletteEntry => ({ name: k, desc: BOX_DESC[k], run: () => this.ed.setBox(k), keep: true, tags: 'box environment structure' })),
      { name: 'number', desc: 'number the display formula here: (1), (2)…', run: () => this.ed.toggleEqNumber() },
      { name: 'ref', desc: 'refer to a numbered formula or theorem: (3), Theorem 2', run: () => this.openPalette('ref') },
      { name: 'link', desc: 'link to a note: [[its name]]; a web address links by itself', run: () => this.ed.typeText('[[]]', 2) },
      { name: 'fold', desc: 'fold or unfold the section under this heading  ctrl+.', run: () => this.ed.toggleFold() },
      { name: 'foldall', desc: 'fold every section', run: () => this.ed.foldAll(true) },
      { name: 'unfoldall', desc: 'unfold every section', run: () => this.ed.foldAll(false) },
      { name: 'outline', desc: `${this.ed.showOutline ? 'hide' : 'show'} the outline: headings and theorems  ctrl+shift+o`, run: () => this.ed.toggleOutline() },
      { name: 'replace', desc: 'find and replace  ctrl+h', run: () => this.ed.finder.openFind(true) },
      { name: 'zoom', desc: `back to 100% (now ${Math.round(this.ed.zoom * 100)}%)  ctrl+0`, run: () => this.ed.setZoom(1) },
      { name: 'theme', desc: `next theme (${this.ed.config.theme})`, run: () => this.ed.cycleTheme() },
      { name: 'settings', desc: 'settings  ctrl+,', run: () => (this.ed.showSettings = true) },
      { name: 'toolbar', desc: `${this.ed.config.ui.toolbar ? 'hide' : 'show'} the toolbar`, run: () => this.ed.toggleBar('toolbar') },
      { name: 'statusbar', desc: `${this.ed.config.ui.statusBar ? 'hide' : 'show'} the status bar`, run: () => this.ed.toggleBar('statusBar') },
      { name: 'substitutions', desc: 'edit substitutions', run: () => ((this.ed.settingsView = 'subs'), (this.ed.showSettings = true)) },
      { name: 'config', desc: 'edit the config file', run: () => this.ed.editConfig() },
      { name: 'export', desc: 'copy document as LaTeX', run: () => this.ed.copyText(docToLatex($state.snapshot(this.ed.doc) as Doc), 'LaTeX') },
      { name: 'markdown', desc: 'save a copy as markdown (.md), for Obsidian and the like', run: () => void this.ed.saveMarkdownCopy() },
      { name: 'copymarkdown', desc: 'copy document as markdown', run: () => this.ed.copyText(docToMarkdown($state.snapshot(this.ed.doc) as Doc).text, 'markdown') },
      { name: 'pdf', desc: 'save as a PDF file  ctrl+p', run: () => this.ed.paper.exportPdf() },
      { name: 'json', desc: 'copy document as JSON', run: () => this.ed.copyText(JSON.stringify($state.snapshot(this.ed.doc)), 'JSON') },
      { name: 'import', desc: 'replace document with JSON from clipboard', run: () => this.ed.importJSON() },
      { name: 'new', desc: 'new note  ctrl+n', run: () => this.ed.files.newNote() },
      { name: 'open', desc: 'open a note  ctrl+o', run: () => this.ed.files.openNote() },
      ...(F.isDesktop()
        ? []
        : [
            { name: 'notes', desc: 'your notes  ctrl+o', run: () => this.ed.files.openNote() },
            { name: 'backup', desc: 'save every note kept in this browser to a zip file', run: () => void this.ed.files.backupNotes() },
            { name: 'restore', desc: 'bring back notes from a backup (or .ntx and .md files)', run: () => void this.ed.files.restoreNotes() },
          ]),
      { name: 'save', desc: 'save  ctrl+s', run: () => this.ed.files.saveNote() },
      { name: 'saveas', desc: 'save as…  ctrl+shift+s', run: () => this.ed.files.saveNoteAs() },
      { name: 'welcome', desc: 'open the welcome note', run: () => this.ed.openWelcome() },
      { name: 'forget', desc: 'forget which commands you use most', run: () => (U.forget(), this.ed.flash('the palette is back to its first order')) },
      { name: 'help', desc: 'keyboard shortcuts  F1', run: () => (this.ed.showHelp = !this.ed.showHelp) },
    ];
  }
}
