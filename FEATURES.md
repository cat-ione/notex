# notex features

Math notes at lecture speed: prose and math in one flow, drawings attached to what they
point at, and a pen and touch screen that work as well as a keyboard.

## Writing

- Plain typing on an endless page; every note is saved as you type.
- Markdown as in Obsidian, read from the text, its markers hidden once the caret moves on:
  - `#`, `##`, `###` headings
  - `**bold**`, `*italic*`, `~~struck~~`, `==highlighted==`, `` `code` ``
  - `- ` bullet lists and `1. ` numbered lists, nested with Tab / Shift+Tab
  - `- [ ]` / `[x]` lists to tick (Ctrl+Enter or a click ticks)
  - `> ` quotes
  - `---` alone on a line, a horizontal line
  - ```` ``` ```` code blocks, coloured by language (Python, C++, Julia, R, MATLAB and more)
- Ctrl+B / Ctrl+I / Ctrl+E / Ctrl+Shift+X / Ctrl+Shift+H put the markers round a selection.
- Brackets and quotes close themselves; markdown markers pair over a selection.
- Snippets and substitutions as you type (`->` → `→`, your own in the config).
- Alt+↑ / Alt+↓ move a paragraph.
- Paste from anywhere: a chat answer, a web page, a LaTeX source, another notes app. Math
  (`$…$`, `\(…\)`, `\[…\]`) comes in as formulas, markdown as structure.

## Math

- `$` starts a formula, `$$` a display formula; `$`, → or Esc goes back to text.
- Typed as you'd say it: `a/b` a fraction, `x^2` and `a_n` scripts, `e^(-x^2/2)` groups,
  `(a+b)/2` takes the brackets as the numerator.
- `\name` gives any LaTeX command, with a searchable palette; `;a` → α.
- `\int`, `\sum`, `\prod`, `\lim` come with empty limits to fill (space moves on);
  `\intop`, `\sumop`… give the bare symbol. In a display formula they're big, limits under
  and over; `\dint`, `\dsum`, `\dlim`… make them so in a sentence too (as `\dfrac`).
- Greek names, functions, `<=`, `!=`, `oo` and more become symbols (each group can be switched
  on or off).
- Matrices, cases and aligned equations: `&` for a new column, Enter for a new row; a click
  goes into any cell, empty ones too. `\pmatrix3x3` and `\pmatrix4x4` (and the like) start
  bigger. Rows and columns are added and deleted with `\addrow`, `\deleterow`,
  `\addcolumn`, `\deletecolumn` or a right-click; Backspace in an empty row or column takes
  it away.
- `x^2` or `a_n` typed in a sentence turns into math by itself.
- Selections inside formulas: Shift+arrows, wrap the selection in `/`, `(`, `\sqrt`…
- Empty boxes disappear once you leave the formula; nothing empty is exported.

## Structure for lecture notes

- Boxes: `\theorem`, `\lemma`, `\proposition`, `\corollary`, `\definition`, `\example`,
  `\remark`, `\proof`, `\quote`. Numbered as in a book (theorems, lemmas, definitions and
  examples together); a proof ends with ∎; a name in brackets becomes the theorem's name.
- `\number` numbers a display formula: (1), (2)…
- `\ref` refers to a numbered formula or box; the number follows as things move, and
  Ctrl+click goes there.
- Links: `[[Another note]]`, `[[note|shown text]]`, `[text](address)` and bare web addresses;
  Ctrl+click (or a tap) opens them. A missing note is made when its link is opened.
- Folding: Ctrl+. or the ▾ in the margin folds a heading's section (`\foldall`, `\unfoldall`).
- The outline (Ctrl+Shift+O): headings and theorems down the side; click to go there.
- Tables, as in markdown or with `\table`: Tab to the next cell, Enter for a new row (empty
  rows stay), ↓ from the last row to the line below (made if the table ends the note), whole
  cells selected, rows and columns added, removed and aligned from a right-click. Words are
  selected within their cell (double-click a word, triple-click the cell, Ctrl+Shift+arrows).
  A table goes with `\deletetable` (or its right-click menu), or by selecting all its cells
  and pressing Delete.
- Images: paste, drop or `\image`; resize by dragging a corner; a caption under each.

## Drawing on your math

- Alt+drag from one word or symbol to another draws an arrow; Alt+Shift+drag draws a box,
  circle, underline, highlight, brace or strike.
- Drawings are attached to what they point at and follow it as you edit.
- A click selects one (a highlight, under the text, by its edge); drag its ends to cover more
  or less.
- Notes on any drawing (`L`), colours, dashes, bends, arrowheads; all by keys or the mouse.
- Ctrl+D opens the draw menu; with a selection, `\box`, `\circle`… draw on it.

## Diagrams and the pen

- `\diagram`: a canvas as wide as the text, with a caption.
- Boxes, ellipses, diamonds and text with `$math$` in their labels; lines and arrows that
  stay attached to the boxes they join; a pen and a highlighter; an eraser.
- Ctrl+arrow on a box adds the next one, joined by an arrow: flowcharts from the keyboard.
- Shapes go exactly where you put them; a line ending on a box stays at that spot on it and
  moves with it. Snapping to a grid and to box edges is a setting (Alt: the other way).
- Resize handles (with any tool: a box just drawn by pen resizes with the pen), duplicate,
  front/back, colours, widths, dashes, fill; a right-click for what can be done there.
- Ctrl+Shift+D draws in a diagram, or anywhere on the note, pinned to the line under it.
- Graphs: `\graph` (or `g`) plots what you type, `y = sin x`, one function a line,
  `x: -2pi..2pi` for the range; axes, ticks in π, a legend, breaks at asymptotes.
- A rough line, box, circle or diamond drawn with the pen and held still straightens.

## Pen and touch

- A pen just draws, anywhere; its width follows the pressure, its eraser end erases;
  typing goes back to the text.
- The pen's side button: drag for a lasso round what to select (on a shape, it moves it);
  tap for the ring menu.
- The ring menu round the pen or finger (side button, a finger held still, a long press):
  the tools, colours, undo / redo; on a selection, what can be done to it. Tap an item or
  slide to it and lift.
- A ⋯ beside a selection made with a pen or finger opens the same ring.
- Fingers draw until a pen has been used; then they scroll (with a flick that coasts) and a
  resting palm does nothing.
- Two fingers tapped undo, three redo.
- Pinch to zoom; bigger handles for a pen or finger.
- A tap on the text brings up the touch keyboard; suggestions and corrections work.

## Finding your way

- The command palette (`\` or Ctrl+K): every command, searchable with typos forgiven, by
  a word of what it does or its group (`draw`, `style`, `table`…); what fits where the
  caret is comes first; what you use most comes first (can be switched off).
- Right-click menus with what fits there: a table's rows, a formula's math, a selection's
  styles.
- Find (Ctrl+F, F3) in text, math and drawings' notes; find and replace (Ctrl+H).
- Zoom: Ctrl+wheel, a trackpad pinch, Ctrl+= / Ctrl+- / Ctrl+0.

## Files

- In the browser: every note kept as you type; Ctrl+O lists them (filter by name or by
  what they say, rename, delete); Ctrl+N a new note.
- Ctrl+S saves to a `.ntx` file and keeps saving to it (Chrome, Edge; elsewhere it downloads).
- On the desktop app, notes are files that save themselves.
- Markdown: `\markdown` saves a copy as `.md` (boxes as callouts, `\tag` for numbered
  formulas), `\copymarkdown` copies it; `.md` files open as notes.
- Works offline once opened, and installs as an app (also on Android); a new version shows
  on a plain reload.

## Sharing

- `\pdf`, Ctrl+P or the toolbar's pdf saves the note as a PDF file, drawings and all, laid
  out for paper (A4 or Letter, a theme of its own); made right there, no print dialog.
- `\export` copies it as LaTeX: drawings as TikZ, theorems as `amsthm`, references as
  `\eqref` / `\ref`, links as `\href`, graphs and diagrams as figures, the packages listed.

## Making it yours

- Themes: midnight, phosphor, paper, and your own on top of them.
- Text size, page width, fonts, your own CSS.
- Which substitutions happen as you type; your own math and text snippets.
- The toolbar and status bar can be hidden; everything stays on its keys.
- Small windows and phones: bars wrap or swipe, menus stay inside the window, the help is one
  column.
- A config file to edit, in the app or your own editor.
- F1 lists every key; the welcome note shows everything to try.
