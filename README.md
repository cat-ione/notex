# notex

A note-taking app for math. You type text and formulas together, fast enough to keep up
with a lecture, and you can draw arrows, boxes and notes directly on parts of an equation.

![notex](docs/screenshot.png)

**Try it in your browser:** https://cat-ione.github.io/notex/

## Features

- **Math as you type.** Press `$` to start a formula. Fractions, exponents and subscripts work
  the way you'd write them (`a/b`, `x^2`, `a_n`), and any LaTeX command is available with `\`.
  Formulas are rendered with KaTeX as you type.
- **Drawings that stay attached.** Draw arrows between symbols, or circle, box, underline and
  annotate parts of your notes. Drawings stay attached to what they point at while you keep
  editing.
- **Markdown.** Headings, lists, checklists, bold, italic, links, quotes and code blocks with
  syntax highlighting, written as plain markdown.
- **Built for lecture notes.** Theorem, definition and proof boxes, numbered equations, and
  references that keep their numbers up to date. Fold sections, see an outline, and search
  across all your notes.
- **Tables, diagrams and graphs.** Markdown tables that work like a spreadsheet, simple
  diagrams and flowcharts, and plots of functions you type in.
- **Pen and touch.** Write and draw with a pen on a tablet, with a tool menu that opens where
  the pen is.
- **Export.** Save a note as a PDF, copy it as LaTeX (drawings included), or save it as
  markdown.
- **Make it yours.** Themes, fonts, text size, your own snippets and custom CSS.

## Getting started

The quickest way is the [browser version](https://cat-ione.github.io/notex/). Notes are saved
in your browser as you type, and once loaded it also works offline and can be installed as an
app.

There are no desktop releases yet. To run the desktop app, build it from source (see
[Development](#development)).

## Basics

| Key | What it does |
|---|---|
| `$` / `$$` | Start an inline / display formula |
| `\` or Ctrl+K | Command palette |
| Esc | Leave a formula |
| Alt+drag | Draw an arrow |
| Alt+Shift+drag | Draw a shape |
| Ctrl+B / Ctrl+I | Bold / italic |
| Ctrl+F / Ctrl+H | Find / find and replace |
| Ctrl+S / Ctrl+O / Ctrl+N | Save / open / new note |
| Ctrl+P | Save as PDF |
| Ctrl+, | Settings |
| F1 | Help, with every shortcut |

## Files

In the browser, every note is kept automatically; Ctrl+O lists them. Ctrl+S also saves the
note to a file. Notes are saved as `.ntx` files (compact JSON), and `.md` files can be opened
too.

## Settings

Ctrl+, opens the settings and the config file. On the desktop app, the file is `config.json`
in the app's config folder, and you can edit it in any editor. For example:

```jsonc
{
  "theme": "midnight",                  // or phosphor, paper, or your own
  "fontSize": 16,
  "fonts": { "prose": "", "mono": "" },
  "snippets": {
    "math": { "norm": "\\left\\| # \\right\\|" },   // # is where the cursor goes
    "text": { "->": "→" }
  },
  "themes": {
    "ember": { "base": "midnight", "colors": { "accent": "#ff9e64" } }
  },
  "css": ".block.h1 { letter-spacing: 0.02em; }"
}
```

## Development

Built with Svelte 5, SvelteKit and Tauri 2, using KaTeX for math and pnpm for packages.

```sh
pnpm install
pnpm dev           # browser version at http://localhost:1420
pnpm tauri dev     # desktop app
pnpm check         # type-check
pnpm test          # unit tests
pnpm test:e2e      # browser tests (set CHROME=<path> to use your own Chrome)
pnpm tauri build   # desktop installer
```

`AGENTS.md` explains how the code is organised and how to work on it.

**Performance tools.** `node tools/perf/perf.mjs` measures editing speed on large notes, and
`node tools/label-lab/lab.mjs` checks how notes on drawings are laid out. Run them against a
production build (`pnpm build && pnpm preview`, then `URL=http://127.0.0.1:4173/?lab`) for
realistic numbers.

**Branches and releases.** Work happens on `dev`, where every push runs the tests. `main` is
what the website is built from: every push to it updates the browser version. Pushing a tag
like `v0.1.0` will build desktop installers into a draft release (bump the version in
`package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` first).

## License

MIT
