// The right-click menu: a drawing's, a table's, a formula's or the page's, and the keys that go
// through it. Part of the Editor (see editor.svelte.ts).

import { MARK_KINDS } from '../marks';
import * as C from '../config';
import * as M from '../math/edit';
import { block, cmd, math, type Id } from '../model';
import type { Editor, DrawingAction } from '../editor.svelte';
import { TABLE_ACTIONS, MATRIX_ACTIONS, cmpPos, round, MARK_VERB } from '../editor.svelte';

export class Menus {
  constructor(private ed: Editor) {}

  // ── right-click menu ──

  /** The open right-click menu, at a window position: a drawing's (`id`), or the page's. */
  menu = $state<{ id: Id | null; x: number; y: number; sel: number; table?: true; sketch?: true } | null>(null);

  get menuItems(): DrawingAction[] {
    if (!this.menu) return [];
    if (this.menu.table) return this.tableActions();
    if (this.menu.sketch) return this.ed.sketch.actions();
    return this.menu.id ? this.ed.drawings.drawingActions(this.menu.id).filter((a) => a.menu !== false && !a.keyOnly) : this.pageActions();
  }

  /** What the page's menu offers: the clipboard, drawing on the selection, undo. */
  pageActions(): DrawingAction[] {
    const sel = !!this.ed.selection || !!this.ed.mathSelRange;
    const what = sel ? 'the selection' : 'something';
    const clip = (cmd: 'copy' | 'cut') => () => document.execCommand(cmd);
    return [
      { name: 'cut', desc: 'cut', keys: ['C-x'], run: clip('cut'), off: !sel },
      { name: 'copy', desc: 'copy', keys: ['C-c'], run: clip('copy'), off: !sel },
      { name: 'paste', desc: 'paste', keys: ['C-v'], run: () => void this.pasteFromClipboard() },
      { name: 'all', desc: this.ed.mode === 'math' ? 'select the formula' : 'select everything', keys: ['C-a'], run: () => this.runKey('C-a') },
      // what fits where the caret is: in math, math; in a table, its rows, columns and alignment; on selected text, styles
      ...(this.ed.mode === 'math' ? this.mathActions() : []),
      ...(this.ed.mode === 'text' && this.ed.tables.tableRow() ? this.tableActions() : []),
      ...(this.ed.mode === 'text' && !this.ed.tables.tableRow() && this.ed.selection
        ? ([['bold', 'bold', 'C-b'], ['italic', 'italic', 'C-i'], ['inlinecode', 'code', 'C-e'], ['strikethrough', 'strike out', 'C-S-x'], ['texthighlight', 'highlight', 'C-S-h']] as const).map(([name, desc, key], i): DrawingAction => ({ name, desc, keys: [key], run: () => this.runKey(key), ...(i === 0 ? { sep: true as const } : {}) }))
        : []),
      ...(this.ed.mode === 'text' ? [{ name: 'formula', desc: 'insert math', keys: ['$'], run: () => this.runKey('$'), more: '$$ for display math', sep: true } as DrawingAction] : []),
      { name: 'arrow', desc: sel ? 'arrow from the selection' : 'draw an arrow', keys: ['\\arrow'], run: () => this.ed.drawings.startArrow(), more: 'or alt+drag', sep: true },
      ...MARK_KINDS.map((k): DrawingAction => ({ name: k, desc: `${MARK_VERB[k]} ${what}`, keys: [`\\${k}`], run: () => this.ed.drawings.startMark(k), more: k === this.ed.lastMarkKind ? 'or alt+shift+drag' : undefined })),
      { name: 'undo', desc: 'undo', keys: ['C-z'], run: () => this.runKey('C-z'), sep: true },
      { name: 'redo', desc: 'redo', keys: ['C-y'], run: () => this.runKey('C-y') },
    ];
  }

  /** A table's rows, columns and alignment, as menu entries. */
  tableActions(): DrawingAction[] {
    return TABLE_ACTIONS.map(([what, name, desc], i): DrawingAction => ({ name, desc, keys: [`\\${name}`], run: () => this.ed.tables.tableCommand(what), ...(i === 0 ? { sep: true as const } : {}) }));
  }

  /** In a formula: the commonest structures (wrapping the selection, if any), and the rest of math's commands. */
  /** A row or column of the matrix the caret is in, added or taken away. */
  matrixCommand(what: 'row+' | 'row-' | 'col+' | 'col-') {
    const item = this.ed.mathItem;
    if (!item || !M.gridAt(item.root, this.ed.mc)) return this.ed.flash('not in a matrix');
    this.ed.checkpoint();
    this.ed.msel = null;
    if (!M.gridEdit(item.root, this.ed.mc, what)) this.ed.flash(what === 'row-' ? 'a matrix keeps one row' : 'a matrix keeps one column');
  }

  private mathActions(): DrawingAction[] {
    const put = (name: string) => () => {
      this.ed.commands.openPalette('math');
      this.ed.palette!.query = name;
      this.ed.commands.acceptPalette(undefined);
    };
    const acts: [string, string][] = this.ed.mathSelRange
      ? [['frac', 'a fraction over it'], ['sqrt', 'a square root of it'], ['hat', 'a hat on it'], ['bar', 'a bar over it'], ['boxed', 'a box round it']]
      : [['frac', 'fraction'], ['sqrt', 'square root'], ['sum', 'sum'], ['int', 'integral'], ['pmatrix', 'matrix']];
    const grid = this.ed.mathItem && M.gridAt(this.ed.mathItem.root, this.ed.mc)
      ? MATRIX_ACTIONS.map(([what, name, desc], i): DrawingAction => ({ name, desc, keys: [`\\${name}`], run: () => this.matrixCommand(what), ...(i === 0 ? { sep: true as const } : {}) }))
      : [];
    return [
      ...grid,
      ...acts.map(([name, desc], i): DrawingAction => ({ name, desc, keys: [`\\${name}`], run: put(name), ...(i === 0 ? { sep: true as const } : {}) })),
      { name: 'mathcommands', desc: 'every math command', keys: ['\\'], run: () => this.ed.commands.openPalette('math') },
    ];
  }

  /** In a table, the toolbar's table button: the table's menu, under it. */
  openTableMenu(under: DOMRect): boolean {
    if (!this.inTable) return false;
    this.menu = { id: null, x: under.left, y: under.bottom + 2, sel: 0, table: true };
    return true;
  }

  /** Whether the caret is in a table's cell (as text, not in a formula). */
  get inTable(): boolean {
    return this.ed.mode === 'text' && !!this.ed.tables.tableRow();
  }

  /**
   * Right-click on the page: its menu. Outside the selection the caret moves to the click
   * first (inside it, the selection stays, for the menu to act on).
   */
  openPageMenu(e: MouseEvent) {
    e.preventDefault();
    // (the pen's side button selects: not a right-click)
    if (this.ed.sketch.barrelClick()) return;
    // a finger or pen held down (a long press is a right-click to the browser): the ring there
    const type = (e as PointerEvent).pointerType ?? '';
    if (type === 'touch' || type === 'pen' || (this.ed.pointer !== 'mouse' && !e.button && !type)) {
      this.ed.sketch.cancelGesture();
      // (the press still down: sliding it to an item and lifting chooses)
      const id = (e as PointerEvent).pointerId;
      this.ed.openRadial(e.clientX, e.clientY, typeof id === 'number' && id >= 0 ? id : undefined);
      this.ed.touch();
      return;
    }
    // drawing, or on a diagram: what can be done to the shape there (or what can be drawn)
    const svg = (e.target as Element | null)?.closest?.('svg.canvas');
    const canvas = svg ? ((svg.closest('[data-diagram]') as HTMLElement | null)?.dataset.diagram ?? null) : null;
    if (this.ed.mode === 'sketch' || canvas) {
      this.ed.withFrame(() => {
        if (canvas && !this.ed.sketch.isOn(canvas)) this.ed.sketch.enter({ kind: 'block', id: canvas }, { tool: 'select' });
        this.ed.sketch.pickAt(e);
        this.menu = { id: null, x: e.clientX, y: e.clientY, sel: 0, sketch: true };
        this.ed.touch();
      });
      return;
    }
    this.ed.withFrame(() => {
      if (this.ed.noteEd.note) this.ed.noteEd.commitNote();
      if (this.ed.mode === 'style' || this.ed.mode === 'pick' || this.ed.mode === 'hint') this.ed.drawings.endDrawing();
      if (this.ed.mode === 'palette') this.ed.commands.closePalette();
      const h = this.ed.hitTest(e.clientX, e.clientY);
      if (h && !h.math) h.pos = this.ed.tables.snapClick(h.pos, e.clientX, e.clientY);
      const s = this.ed.selection;
      const inSel = !!s && !!h && !h.math && cmpPos(h.pos, s.s) >= 0 && cmpPos(h.pos, s.e) <= 0;
      const inFormula = !!h?.math && this.ed.mode === 'math' && h.pos.b === this.ed.b && h.pos.o === this.ed.o && !!this.ed.mathSelRange;
      if (h && !inSel && !inFormula) {
        this.ed.anchor = null;
        this.ed.msel = null;
        this.ed.b = h.pos.b;
        this.ed.o = h.pos.o;
        if (h.math) (this.ed.mc = this.ed.mathPos(h.math)), this.ed.setMode('math');
        else this.ed.setMode('text');
      }
      this.menu = { id: null, x: e.clientX, y: e.clientY, sel: Math.max(0, this.pageActions().findIndex((a) => !a.off)) };
      this.ed.touch();
    });
  }

  /** Paste from the clipboard (from the menu: there's no paste event to read it from). */
  private async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      this.ed.withFrame(() => { this.ed.pasteText(text); this.ed.touch(); });
    } catch {
      this.ed.flash("can't read the clipboard, use ctrl+v");
    }
  }

  /** Run a key as if it had been pressed (in the current mode). */
  runKey(k: string): boolean {
    if (this.ed.noteEd.note && (this.ed.mode === 'text' || this.ed.mode === 'math')) return this.ed.noteEd.noteKey(k);
    switch (this.ed.mode) {
      case 'text': return this.ed.textKey(k);
      case 'math': return this.ed.mathKey(k);
      case 'pick': return this.ed.drawings.pickKey(k);
      case 'style': return this.ed.drawings.styleKey(k);
      case 'hint': return this.ed.hintKey(k);
      case 'palette': return this.ed.commands.paletteKey(k);
      case 'sketch': return this.ed.sketch.key(k);
    }
  }

  /** Select a drawing and open its menu at (x, y), or under the drawing (from the keyboard). */
  openDrawingMenu(id: Id, x?: number, y?: number) {
    this.ed.withFrame(() => {
      if (this.ed.styling !== id || this.ed.mode !== 'style') this.ed.drawings.selectDrawing(id);
      if (x === undefined || y === undefined) {
        const r = this.ed.drawings.drawingRect(id), o = this.ed.page?.getBoundingClientRect();
        if (!r || !o) return;
        x = o.left + r.x;
        y = o.top + r.y + r.h + 4;
      }
      this.menu = { id, x, y, sel: 0 };
      this.ed.touch();
    });
  }

  closeMenu() {
    this.menu = null;
  }

  /** Run a menu entry (it closes first: the action may open something else). */
  runMenu(i: number) {
    const a = this.menuItems[i];
    if (a?.off) return;
    this.menu = null;
    this.ed.withFrame(() => {
      a?.run();
      this.ed.touch();
    });
  }

  menuKey(k: string): boolean {
    const mn = this.menu!;
    const items = this.menuItems;
    switch (k) {
      case 'Escape': this.menu = null; return true;
      // (past entries that can't be used now)
      case 'Down': case 'j': case 'Tab': case 'C-n': mn.sel = this.menuStep(mn.sel, 1); return true;
      case 'Up': case 'k': case 'S-Tab': case 'C-p': mn.sel = this.menuStep(mn.sel, -1); return true;
      case 'Home': mn.sel = this.menuStep(-1, 1); return true;
      case 'End': mn.sel = this.menuStep(items.length, -1); return true;
      case 'Enter': case ' ': this.runMenu(mn.sel); return true;
    }
    // an entry's own key runs it straight away (any other key closes the menu and does its thing)
    const i = items.findIndex((a) => a.keys.includes(k));
    if (i >= 0) this.runMenu(i);
    else {
      this.menu = null;
      return this.runKey(k);
    }
    return true;
  }

  private menuStep(from: number, d: 1 | -1): number {
    const items = this.menuItems, n = items.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + d * k) % n) + n) % n;
      if (!items[i].off) return i;
    }
    return Math.max(0, from);
  }
}
