# AGENTS.md

How to work on notex, for coding agents (and anyone new to the code). What it does is in
`README.md` and `FEATURES.md`; this is the how.

## The project

A math notetaking app: prose and formulas in one flow, drawings attached to what they point
at, a pen and touch screen as good as a keyboard. Svelte 5 (runes) + SvelteKit as a static
SPA + Tauri 2 for the desktop, KaTeX for rendering, pnpm. It is also a PWA on GitHub Pages.

What matters to the owner:

- **Typing at lecture speed.** Nothing should make you stop to fix formatting; markdown is
  read from the text as you type, never a separate mode.
- **Customizable.** Behaviour that someone might not want is a setting (`src/lib/config.ts`,
  shown in `Settings.svelte`), with a sensible default.
- **Terminal-modern look**: mono UI font, quiet panels, keys shown beside actions.
- **Pen and touch first-class**: everything reachable from where the pen is (the ring menu),
  not only from bars.
- **Plain wording** in the UI, help and docs: short, concrete, no em dashes in prose.

## Commands

```sh
pnpm install            # (core-js's install script is denied in pnpm-workspace.yaml: that's fine)
pnpm dev                # the browser version, http://localhost:1420
pnpm test               # unit tests (vitest), src/**/*.test.ts
pnpm check              # svelte-check: must be 0 errors
pnpm test:e2e           # browser tests (Playwright): builds, then serves on :4173
pnpm exec playwright test table sketch   # some of them, by file name
```

`CHROME=<path to chrome.exe> pnpm exec playwright test` uses a Chrome you have instead of
Playwright's own. The browser tests reuse a server already on :4173, so after changing
`src/` stop that server (or let the run build afresh) or you are testing old code.

Opening the app with `?lab` exposes the editor as `window.__nx` (`src/lib/dev.ts`): `__nx.ed`
is the Editor, `__nx.tex()` the LaTeX export, `__nx.formulas()` each formula's LaTeX. The
browser tests drive the app through real keys and pointer events and read the state there.

## Where things are

| | |
|---|---|
| `src/lib/model.ts` | the document: blocks of items (a character or a formula), arrows, marks, ink |
| `src/lib/editor.svelte.ts` | the Editor class: every key, mode, command, the palette's commands, undo |
| `src/lib/components/Editor.svelte` | the page: blocks, caret, selection, menus, the touch keyboard's field |
| `src/lib/markdown.ts` | inline markdown (bold, links…), headings, fences, horizontal lines |
| `src/lib/math/` | the formula tree: typing in it (`edit.ts`), commands (`defs.ts`), LaTeX out (`latex.ts`) and in (`parse.ts`) |
| `src/lib/sketch/` | diagrams and ink: shapes, the Sketcher (pointer gestures, tools), graphs, shape recognition, TikZ |
| `src/lib/tables.ts` | table rows: cells between wall characters |
| `src/lib/format.ts` | the `.ntx` file format (only what can't be read from the text is stored) |
| `src/lib/export.ts`, `mdfile.ts`, `pdf.ts` | LaTeX, markdown, PDF (in the browser) |
| `src/lib/files.ts`, `library.ts` | files on desktop and in the browser; notes kept in the browser |
| `src/lib/config.ts` | settings, their defaults, themes |
| `src/lib/welcome.ts` | the welcome note: shows every feature, so new features go in it |
| `src-tauri/` | the desktop app (Rust): file access, saving a PDF (by the system on Windows) |
| `tests/e2e/` | browser tests, one file per area |
| `tools/` | performance and layout tools (see README) |

## How the editor thinks

- **Markdown is read from the text.** A block's kind (heading, code) and each character's
  flags (bold, mark, link…) come from `Editor.derive` / `deriveBlock` after an edit. Don't
  store what the text already says; do store what it can't (a list item's tick, a box, a
  fold).
- **Undo snapshots are cached per block** (`blockSnaps`). Any change to a block that isn't the
  one being typed in (a diagram's shapes, a tick, a box) must call `forget(blk)` /
  `forgetBlock(blk)`, or undo restores a stale copy.
- **Drawings anchor to ids**, never positions, so they follow the text as it's edited.
- **Modes**: `text`, `math`, `palette`, `style` (a drawing selected), `pick` (choosing an
  arrow's ends), `sketch` (drawing). `touch()` after an action recomputes what depends on it.
- **The palette** (`\` or Ctrl+K) lists commands for a context (`math`, `text`, `draw`,
  `style`, `ref`); a command's `tags` and the `TAGS` map let a group word find it.
- **Pointers**: `ed.pointer` is the last kind used (mouse, pen, touch). The Sketcher takes
  pen and finger gestures; the pen's side button selects; a tap of it, or a finger held,
  opens the ring menu (`RadialMenu.svelte`).
- **Free ink is stored unzoomed**; the zoom (`--zoom`) is applied when drawing it.

## Conventions

- **Match the surrounding code**: its comment density, naming and idiom. Comments say why,
  in plain sentences; a parenthetical aside is common, as `// (a closed loop: not a tap)`.
- **Small, focused commits** as work goes on; the message says what changed for the user.
- **Tests with every change**: a unit test for logic in a plain module, a browser test for
  anything you'd check by using the app. Test names read as a sentence of what happens.
- **Docs move with features**: F1 help (`Help.svelte`), `README.md`, `FEATURES.md`, the
  welcome note, and the status bar's hints (`StatusLine.svelte`).
- **No new dependency** without a good reason; load heavy ones only when used (`import()`).
- **Don't break files**: `format.ts` must keep opening notes saved by older versions.

## Branches

Work on `dev`; every push there runs the tests and the type-check in CI. `main` is what the
site and releases are built from: merge into it only when asked.

## Gotchas

- On Windows, shell heredocs can mangle backslashes and non-ASCII characters (`\`, `’`).
  Write scripts and test strings to a file with an editor tool, or build them with
  `String.raw` / `String.fromCharCode(92)` in tests.
- Playwright counts zero-size elements as hidden: the ring menu's root is 0×0, so check one
  of its parts (`.radial .middle`).
- An SVG captured for the browser PDF loses the page's stylesheet; `pdf.ts` writes the
  computed styles onto it for the capture. The capture (html-to-image) lays a copy of the page
  out again, and anything that moves it moves the text away from the drawings: it shrinks
  font sizes, fixes every box's height (so margins don't collapse through it) and rounds
  borders to another pixel ratio. `pdf.ts` works round these; prefer padding to margins and
  avoid inset shadows in the paper layout (`html.nx-print`). `tests/e2e/pdfpages.e2e.ts`
  reads the PDF back (`pdfread.ts`) and compares each sheet with the screen.
- The page is copied once for the whole PDF, and only the CSS properties in `PAPER_STYLES`
  (`pdf.ts`) are copied, and only where they differ from what the copy would have anyway:
  copying is nearly all the time a PDF takes. Styling the paper layout with a property not in
  that list fails a test in `pdfpages.e2e.ts`; add it there. `patches/` holds a small speed fix
  to html-to-image (see `pnpm-workspace.yaml`).
- Pointer tests send synthetic `PointerEvent`s; real pens and touch screens differ (a long
  press is also a `contextmenu`, the side button a right-click), so handle both.
