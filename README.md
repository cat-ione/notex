# notex

Math notes at lecture speed. Type prose and math in one flow, without reaching for the mouse,
and draw arrows and boxes *between parts of equations*.

![notex](docs/screenshot.png)

**Try it in the browser:** https://cat-ione.github.io/notex/

## What it does

- **Math the way you say it.** `$` starts a formula. `a/b` is a fraction, `x^2` and `a_n` are
  scripts, `e^(-x^2/2)` groups, and `\name` gives any LaTeX symbol. Typing `x^2` or `a_n` in a
  sentence turns it into math by itself.
- **Draw on your notes.** Alt+drag from one word or symbol to another draws an arrow;
  Alt+Shift+drag draws a box, circle, underline or brace. Press `L` to write a note on it.
  Drawings stay attached to what they point at as you keep editing.
- **Markdown, like Obsidian.** `# ` headings, `- ` and `1. ` lists, `- [ ]` lists to tick,
  `**bold**`, `*italic*`, `~~struck~~`, `==highlighted==`, `> ` quotes, `[[links]]` to other
  notes and web addresses, `` `code` `` and code blocks, coloured by their language (Python,
  C++, Julia, R, MATLAB and more). The markers hide once the caret moves on.
- **Structured like a textbook.** `\theorem`, `\definition`, `\lemma`, `\proof`… put lines in a
  box, numbered as in a book. `\number` numbers a display formula and `\ref` refers to it or to
  a theorem, and the number follows along as things move. Fold a section under its heading
  (Ctrl+.), see the outline (Ctrl+Shift+O), find and replace (Ctrl+H), and find a note by what
  it says from the notes list.
- **Tables**, as in markdown (`| a | b |` with a `| --- |` line under the header), or `\table`.
  Cells work as in a word processor: Tab moves between them, Enter adds a row, selecting
  across cells selects whole cells, and a right-click in one adds or removes rows and columns
  and aligns them. Formulas and drawings work inside them; files keep them as markdown.
- **Diagrams, and the pen.** `\diagram` makes one: boxes, ellipses, diamonds and text with
  `$math$` in their labels, lines and arrows that stay attached to the boxes they join, and
  pen strokes. Ctrl+arrow on a box adds the next one, joined to it, so a flowchart needs no
  mouse. Ctrl+Shift+D draws in it, or anywhere on top of the note, where a drawing stays with
  the line under it. A pen just draws (its width follows the pressure, its eraser end erases);
  a finger draws too, until a pen has been used, then it scrolls and a resting palm does
  nothing. Diagrams export to LaTeX as TikZ.
- **Graphs.** `\graph` plots what you type: `y = sin x`, a line each, `x: -pi..pi` for the range.
- **Zoom.** Ctrl+wheel, a pinch on a trackpad or touch screen, or Ctrl+= / Ctrl+- / Ctrl+0: the
  text, images, diagrams and what's drawn on the page grow together.
- **Images.** Paste or drop them in; they're kept inside the note.
- **Yours to change.** Themes, text size, fonts, snippets, which substitutions happen as you
  type, and your own CSS (Ctrl+,).
- **PDF, LaTeX and markdown.** `\pdf` saves the note as a PDF, drawings and all (Ctrl+P prints
  it); `\export` copies it as LaTeX, drawings, theorems and references included (tikz,
  amsthm); `\markdown` saves it as markdown, and `.md` files open as notes.

Press **F1** in the app for every shortcut.

## Keys worth knowing

| | |
|---|---|
| `$` / `$$` | inline / display math |
| `\` or Ctrl+K | command palette |
| `/` `^` `_` | fraction, superscript, subscript |
| space / Tab | leave a box / next box |
| `$`, → or Esc | back to text |
| Alt+drag, Alt+Shift+drag | arrow, shape |
| Ctrl+D | draw menu |
| Ctrl+Shift+D | draw in a diagram, or on the note (`\diagram` makes one) |
| `v p l a r o d t g e` | while drawing: select, pen, line, arrow, box, ellipse, diamond, text, graph, eraser |
| Ctrl+B / Ctrl+I | bold / italic |
| Ctrl+Shift+X / Ctrl+Shift+H | strike out / highlight |
| `[ ]` then space, Ctrl+Enter | a box to tick, tick it |
| `\theorem` `\proof` `\ref` | a theorem, a proof, a reference |
| Ctrl+. / Ctrl+Shift+O | fold a section / the outline |
| Ctrl+click | open a link, go to what a reference points at |
| Tab / Shift+Tab | indent / outdent a list item |
| Ctrl+F / Ctrl+H | find / find and replace |
| Ctrl+wheel, a pinch, Ctrl+= / Ctrl+- / Ctrl+0 | zoom |
| Ctrl+S / Ctrl+O / Ctrl+N | save / open / new |
| `\pdf` / Ctrl+P | save as PDF / print |

## Files

In the browser, every note is kept there as you type: Ctrl+O lists them (type to filter, F2
renames, Shift+Del deletes) and Ctrl+N starts a new one. Ctrl+S also saves the note to a
`.ntx` file and keeps saving to it (in Chrome and Edge; other browsers download it). Once
opened, the site works offline and can be installed as an app.

Notes are `.ntx` files: compact JSON (see `src/lib/format.ts`).

## Customizing

The toolbar along the top has notes, saving, math, drawing, images, find and PDF, each
showing its keys when hovered; it fades while you type. It and the status bar can be hidden
(settings, `\toolbar`, `\statusbar`), and everything stays on its keys.

The palette (`\`) and the right-click menu start with what fits where the caret is: a
table's rows and columns in a table, styles on selected text, math in a formula; in a table,
the toolbar's table button opens the table's menu. The palette also remembers what you pick
most (and lately) and puts that first; `\forget` clears it, and the setting `remember
commands` turns it off.

Ctrl+, opens settings and an editor for the config file. On desktop the file is `config.json`
in the app's config directory; you can also open it in your own editor, and changes load when
you switch back to notex.

```jsonc
{
  "theme": "ember",                       // built-in: midnight, phosphor, paper
  "fontSize": 16,
  "pageWidth": 820,
  "fonts": { "prose": "", "mono": "" },   // any CSS font-family
  "typing": { "pairBrackets": true, "autoMath": true },
  "snippets": {
    "math": {                             // expand while typing in math; # = caret
      "norm": "\\left\\| # \\right\\|",
      "pd": "\\frac{\\partial #}{\\partial }"
    },
    "text": { "->": "→" }                 // text may contain $math$
  },
  "themes": {                             // CSS variable overrides on a base theme
    "ember": { "base": "midnight", "colors": { "accent": "#ff9e64" } }
  },
  "css": ".block.h1 { letter-spacing: 0.02em; }"
}
```

## Development

Svelte 5 + SvelteKit (SPA) + Tauri 2, KaTeX for rendering, pnpm.

```sh
pnpm install
pnpm tauri dev     # desktop app
pnpm dev           # browser only, http://localhost:1420
pnpm check         # type-check
pnpm test          # unit tests
pnpm test:e2e      # browser tests (builds the site; CHROME=<path> to use your own Chrome)
pnpm tauri build   # desktop installer for this system
```

With `pnpm dev` running (or a production build served with `?lab` in the URL):

```sh
node tools/perf/perf.mjs [--profile[=action]] [--file=note.ntx]   # editing speed on large notes
node tools/label-lab/lab.mjs <name>             # note layout scenarios + typing check
```

Both use `playwright-core`; set `CHROME` to a Chrome/Chromium executable if it can't find one.

**Branches.** Work happens on `dev`, where every push runs the unit and browser tests and the type-check. Merge
into `main` once it works: `main` is what the site and releases are built from.

**Releasing.** Every push to `main` rebuilds the browser version on GitHub Pages. There are no
desktop releases yet; when there are, pushing a tag like `v0.1.0` builds the installers for all
three systems into a draft release to publish from the Releases page (bump the version in
`package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` first).

### How it works

- **Document model** (`src/lib/model.ts`): blocks of items; an item is a character or a
  math item. Math is a tree of `sym`s and slot-bearing `cmd`s (frac, sqrt, scripts,
  delimiters, matrices…). Every node has a stable id.
- **Rendering** (`src/lib/math/latex.ts`): the tree is turned into LaTeX where each node is
  wrapped in `\htmlData{nx=<id>}`. KaTeX treats these as transparent for spacing, so the
  output looks normal but every glyph maps back to a node. That mapping drives the caret,
  jump labels and arrow endpoints.
- **Arrows and shapes** anchor to *ids*, not to positions, so they follow their endpoints as you edit.
  Geometry is recomputed from the DOM after each render (`src/lib/arrows.ts`).
- **Editor** (`src/lib/editor.svelte.ts`): ordinary text editing by default; focused modes only
  for math, choosing arrow endpoints and styling drawings.

## License

MIT
