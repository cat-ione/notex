// User configuration: themes, sizes, fonts, snippets and custom CSS.
//
// Desktop: <app config dir>/config.json (written with defaults on first run so
// there is something to edit). Browser: localStorage.

import { isDesktop } from './files';
import { SUB_DEFAULTS } from './math/defs';

export type ThemeDef = { base?: string; colors: Record<string, string> };

export type Config = {
  /** A built-in theme (midnight, phosphor, paper) or one defined under `themes`. */
  theme: string;
  fontSize: number;
  pageWidth: number;
  fonts: { prose: string; mono: string };
  /**
   * Your own substitutions, made as you type their trigger (they win over the built-in ones).
   * math: trigger → LaTeX (`#` marks where the caret goes).
   * text: trigger → replacement text (may contain $math$).
   */
  snippets: { math: Record<string, string>; text: Record<string, string> };
  /** Custom themes: CSS variable overrides on top of a built-in base theme. */
  themes: Record<string, ThemeDef>;
  /** Extra CSS appended to the page. */
  css: string;
  /** Now and then, a one-line tip in the status bar when it's useful (each at most twice). */
  tips: boolean;
  typing: {
    /** Math: `^` / `_` take one thing (`x^2+1`), as in LaTeX; off: stay in the script until space. */
    latexScripts: boolean;
    /** Text: `x^2` or `a_n` typed in prose turns into math. */
    autoMath: boolean;
    /** Text: `(` types `()` with the caret between, `)` steps over one already there; quotes likewise. */
    pairBrackets: boolean;
    /** Text: `` ` `` types a pair; `*`, `_`, `` ` `` and `~` typed over a selection go around it. */
    pairMarkdown: boolean;
    /** Built-in math substitutions, by group (see SUB_GROUPS): `alpha` → α only if `greek` is on. */
    substitutions: Record<string, boolean>;
  };
  /** PDFs and printing: the theme the page is printed in, and the paper size. */
  pdf: { theme: string; paper: Paper };
  /** Colour code blocks by their language (```py, ```cpp …); the colours are --code-* in a theme. */
  highlightCode: boolean;
  /** The bars around the page: the toolbar (and whether it fades while you type) and the status bar. */
  ui: { toolbar: boolean; fadeToolbar: boolean; statusBar: boolean };
};

export type Paper = 'A4' | 'Letter';
/** Paper sizes and the margin around the text, in inches. */
export const PAPERS: Record<Paper, { w: number; h: number }> = { A4: { w: 8.27, h: 11.69 }, Letter: { w: 8.5, h: 11 } };
export const PAPER_MARGIN = 0.7;

export const BUILTIN_THEMES = ['midnight', 'phosphor', 'paper'];

export const DEFAULT_CONFIG: Config = {
  theme: 'midnight',
  fontSize: 16,
  pageWidth: 820,
  fonts: { prose: '', mono: '' },
  snippets: {
    math: {},
    text: {
      '->': '→',
      '=>': '⇒',
      '<-': '←',
    },
  },
  themes: {
    ember: {
      base: 'midnight',
      colors: { accent: '#ff9e64', caret: '#ff9e64', 'mode-text': '#ff9e64', arrow: '#7dcfff', 'hint-bg': '#7dcfff' },
    },
  },
  css: '',
  tips: true,
  typing: { latexScripts: true, autoMath: true, pairBrackets: true, pairMarkdown: true, substitutions: { ...SUB_DEFAULTS } },
  pdf: { theme: 'paper', paper: 'A4' },
  ui: { toolbar: true, fadeToolbar: true, statusBar: true },
  highlightCode: true,
};

const LOCAL_KEY = 'notex.config';

/** Fill in anything missing from a (possibly partial or old) user config. */
export function withDefaults(user: Partial<Config> | null | undefined): Config {
  const u = user ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...u,
    fonts: { ...DEFAULT_CONFIG.fonts, ...(u.fonts ?? {}) },
    snippets: {
      math: oldDefaults(u.snippets?.math) ? {} : (u.snippets?.math ?? DEFAULT_CONFIG.snippets.math),
      text: u.snippets?.text ?? DEFAULT_CONFIG.snippets.text,
    },
    themes: u.themes ?? DEFAULT_CONFIG.themes,
    typing: {
      ...DEFAULT_CONFIG.typing,
      ...(u.typing ?? {}),
      substitutions: { ...SUB_DEFAULTS, ...(u.typing?.substitutions ?? {}) },
    },
    pdf: { ...DEFAULT_CONFIG.pdf, ...(u.pdf ?? {}) },
    ui: { ...DEFAULT_CONFIG.ui, ...(u.ui ?? {}) },
  };
}

/** The math snippets configs used to start with, now the built-in `shorthands` group (off). */
const OLD_DEFAULT_MATH = ['TT', 'dd', 'eps', 'inv', 'norm', 'pd'];
const oldDefaults = (m: Record<string, string> | undefined) =>
  !!m && Object.keys(m).sort().join(' ') === OLD_DEFAULT_MATH.join(' ') && m.eps === '\\varepsilon' && m.TT === '^{\\top}';

export const configToText = (c: Config) => JSON.stringify(c, null, 2) + '\n';

export function parseConfig(text: string): Config {
  const data = JSON.parse(text);
  if (typeof data !== 'object' || !data || Array.isArray(data)) throw new Error('config must be a JSON object');
  return withDefaults(data);
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Load the config, creating the file with defaults on first run. */
export async function loadConfig(): Promise<{ config: Config; error?: string }> {
  try {
    const text = isDesktop() ? await invoke<string | null>('load_config') : localStorage.getItem(LOCAL_KEY);
    if (text == null) {
      await saveConfig(DEFAULT_CONFIG);
      return { config: DEFAULT_CONFIG };
    }
    return { config: parseConfig(text) };
  } catch (e) {
    return { config: DEFAULT_CONFIG, error: `config: ${e instanceof Error ? e.message : e}` };
  }
}

export async function saveConfig(c: Config) {
  const text = configToText(c);
  if (isDesktop()) await invoke('save_config', { contents: text });
  else localStorage.setItem(LOCAL_KEY, text);
}

export async function openConfigExternally(): Promise<string | null> {
  if (!isDesktop()) return null;
  return invoke<string>('open_config');
}

/** Apply the visual parts of a config to the document. */
export function applyConfig(c: Config, extraCss = '') {
  const root = document.documentElement;
  const custom = c.themes[c.theme];
  const base = BUILTIN_THEMES.includes(c.theme) ? c.theme : (custom?.base ?? 'midnight');
  root.dataset.theme = base;

  const vars: string[] = [`--font-size: ${c.fontSize}px;`, `--page-width: ${c.pageWidth}px;`];
  if (c.fonts.prose) vars.push(`--prose: ${c.fonts.prose};`);
  if (c.fonts.mono) vars.push(`--mono: ${c.fonts.mono};`);
  for (const [k, v] of Object.entries(custom?.colors ?? {})) vars.push(`--${k.replace(/^--/, '')}: ${v};`);

  let el = document.getElementById('nx-user-style') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'nx-user-style';
    document.head.appendChild(el);
  }
  // `html:root[data-theme]` outranks the built-in `[data-theme=…]` rules.
  el.textContent = `html:root[data-theme] { ${vars.join(' ')} }\n${c.css}\n${extraCss}`;
}

export const allThemes = (c: Config) => [...BUILTIN_THEMES, ...Object.keys(c.themes).filter((t) => !BUILTIN_THEMES.includes(t))];
