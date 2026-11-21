# notex

Fast math notes. Type prose and math without reaching for the mouse (though it works too),
and draw arrows *between parts of equations*.

Stack: Svelte 5 + SvelteKit (SPA) + Tauri 2, KaTeX for rendering, pnpm.

```sh
pnpm install
pnpm tauri dev     # desktop app
pnpm dev           # browser only, http://localhost:1420
pnpm check         # type-check
```

## How it works

- **Document model** (`src/lib/model.ts`): blocks of items; an item is a character or a
  math item. Math is a tree of `sym`s and slot-bearing `cmd`s (frac, sqrt, scripts,
  delimiters, matrices…). Every node has a stable id.
- **Rendering** (`src/lib/math/latex.ts`): the tree is turned into LaTeX where each node is
  wrapped in `\htmlData{nx=<id>}`. KaTeX treats these as transparent for spacing, so the
  output looks normal but every glyph maps back to a node. That mapping drives the caret,
  jump labels and arrow endpoints.
- **Arrows** anchor to *ids*, not to positions, so they follow their endpoints as you edit.
  Geometry is recomputed from the DOM after each render (`src/lib/arrows.ts`).
- **Editor** (`src/lib/editor.svelte.ts`): ordinary text editing by default; focused modes only
  for math, choosing arrow endpoints and styling arrows.

## Using it (F1 in the app)

It edits like any normal editor: click to place the caret, drag or Shift+arrows to select,
Ctrl+C/X/V (math survives copy/paste), Ctrl+Z/Y, Ctrl+←/→ by word. On top of that:

| | |
|--------|------|
| text   | `$` math (`$$` centered block) · `\` or Ctrl+K commands · `# ` `## ` `- ` block shortcuts |
| math   | `/` fraction from previous operand · `^ _` · `( [ {` · `"` text · `;a` greek · `sum int lim sqrt` · `-> => <= oo xx` · `\name` any command · space leaves a box · Tab next box · `&`/Enter grow matrix · `$`, → or Esc back to text · click anywhere inside a formula |
| `\arrow` | arrow keys or click to choose · Shift+↑/↓ whole expression / inside it · Shift+←/→ extend · Tab jump labels · Enter confirm (start, then end) |
| arrow style | ↑/↓ bend · `0` straight · `t` heads · `d` dashed · `b` box ends · `l` label · `r` reverse · Del remove · Enter done. `\arrows` reselects one |

Arrow picking also accepts `hjkl`/`HJKL` for people who like them.

## Files

Notes are `.ntx` files (Ctrl+S / Ctrl+Shift+S / Ctrl+O / Ctrl+N). Once a note has a file it
autosaves. The format is compact JSON: text is stored as plain strings and math as a tree
(see `src/lib/format.ts`).

## Customizing

Ctrl+, opens settings (theme, text size, page width) and an editor for the config file. On
desktop the file lives in the app config directory as `config.json` and can also be opened in
your own editor; changes load when you switch back to notex.

```jsonc
{
  "theme": "ember",                       // built-in: midnight, phosphor, paper
  "fontSize": 16,
  "pageWidth": 820,
  "fonts": { "prose": "", "mono": "" },   // any CSS font-family
  "snippets": {
    "math": {                             // expand while typing in math; # = caret
      "norm": "\\left\\| # \\right\\|",
      "pd": "\\frac{\\partial #}{\\partial }"
    },
    "text": { "->": "→", ":)": "nice $\\heartsuit$" }   // text may contain $math$
  },
  "themes": {                             // CSS variable overrides on a base theme
    "ember": { "base": "midnight", "colors": { "accent": "#ff9e64" } }
  },
  "css": ".block.h1 { letter-spacing: 0.02em; }"
}
```

## Roadmap / ideas

- **Customization**: keymaps, user palette commands, scripting hooks.
- **Files**: a notes sidebar / recent files, search across notes.
- **Drawing**: shapes (boxes, circles, brackets, highlights) that anchor to text and math like
  arrows do, placed with the mouse or the keyboard.
- **Arrows**: multi-segment routes, endpoint side control, math labels, LaTeX export via
  `tikzmark`.
- Selection inside formulas (copy/cut parts of an equation).
