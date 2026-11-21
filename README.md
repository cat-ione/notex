# notex

Keyboard-first math notes. Type prose and math without leaving the home row, and draw
arrows *between parts of equations* without touching the mouse.

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
- **Editor** (`src/lib/editor.svelte.ts`): one modal state machine (normal / insert / math /
  pick / style + transient palette / hint / label).

## Keys (press `?` in the app)

| where  | keys |
|--------|------|
| normal | `hjkl` `w b` `0 $ gg G` · `i a I A o O` · `x D dd dw J` · `u` / `C-r` · `⏎` edit math · `\` or `:` palette · `f` arrow · `ga` pick arrow |
| insert | `$` inline math (`$$` display) · `\` palette · `# ` `## ` `- ` block shortcuts |
| math   | `/` fraction from previous operand · `^ _` · `( [ {` · `"` text · `;a` greek · `sum int lim sqrt` · `-> => <= oo xx` · `\name` any command · space leaves structure · tab next slot · `&`/`⏎` grow matrix · `$` exit |
| arrow  | `hjkl` move · `K`/`J` zoom out/in of structure · `H`/`L` extend · `f` jump labels · `⏎` confirm |
| style  | `j/k` bend · `=` straight · `r` reverse · `t` heads · `d` dashed · `b` box ends · `i` label · `x` delete |

## Roadmap / ideas

- **Customization**: user config file (snippets → `AUTO_REPLACE`/`MATH_PALETTE`, keymaps,
  palette commands), user CSS themes (all colors are CSS variables already), scripting hooks.
- **Files**: native open/save of `.ntx` via Tauri fs + dialog; multiple notes; search.
- **Drawing without a mouse**: a canvas block with a grid cursor (move with hjkl, drop
  points, box/circle/line from mark to cursor), shapes that can anchor to text like arrows.
- **Arrows**: multi-segment routes, endpoint side control, math labels, LaTeX export via
  `tikzmark`.
- Visual mode + yank/paste (including math subtrees), math selection, LaTeX paste → tree.
