<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { Editor } from '$lib/editor.svelte';
  import { allThemes, configToText, DEFAULT_CONFIG, openConfigExternally } from '$lib/config';
  import { SUB_GROUPS } from '$lib/math/defs';
  import { isDesktop } from '$lib/files';

  let { ed }: { ed: Editor } = $props();

  type Row = { label: string; tip: string; value?: () => string; change?: (dir: 1 | -1) => void; act?: () => void; hint?: string | (() => string) };

  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const onCount = () => SUB_GROUPS.filter((g) => ed.config.typing.substitutions[g.id]).length;
  const mineCount = () => Object.keys(ed.config.snippets.math).length + Object.keys(ed.config.snippets.text).length;
  const rows: Row[] = [
    { label: 'theme', tip: 'Colour scheme: midnight, phosphor or paper. Define your own under "themes" in the config file.', value: () => ed.config.theme, change: (d) => ed.cycleTheme(d) },
    { label: 'text size', tip: 'Font size of the note, in pixels.', value: () => `${ed.config.fontSize}px`, change: (d) => ed.updateConfig({ fontSize: clamp(ed.config.fontSize + d, 11, 28) }) },
    { label: 'page width', tip: 'Maximum width of the page, in pixels. Wider pages fit more on a line.', value: () => `${ed.config.pageWidth}px`, change: (d) => ed.updateConfig({ pageWidth: clamp(ed.config.pageWidth + d * 40, 480, 1600) }) },
    {
      label: 'superscripts & subscripts',
      tip: 'LaTeX-style: ^ and _ take the next character or (…) group, so x^2+1 keeps +1 on the line. End with space: everything typed stays in the script until you press space.',
      value: () => (ed.config.typing.latexScripts ? 'LaTeX-style' : 'end with space'),
      change: () => ed.updateConfig({ typing: { ...ed.config.typing, latexScripts: !ed.config.typing.latexScripts } }),
    },
    {
      label: 'detect math in text',
      tip: 'Typing ^ or _ right after a word in text, like x^2 or a_n, turns it into math without typing $ first.',
      value: () => (ed.config.typing.autoMath ? 'on' : 'off'),
      change: () => ed.updateConfig({ typing: { ...ed.config.typing, autoMath: !ed.config.typing.autoMath } }),
    },
    {
      label: 'close brackets',
      tip: 'Typing ( [ { or " adds the closing one after the caret. Typing the closing one steps over it, and Backspace between an empty pair removes both. With text selected, the brackets go around it.',
      value: () => (ed.config.typing.pairBrackets ? 'on' : 'off'),
      change: () => ed.updateConfig({ typing: { ...ed.config.typing, pairBrackets: !ed.config.typing.pairBrackets } }),
    },
    {
      label: 'close markdown',
      tip: 'Typing ` adds the closing backtick. Typing *, _, ` or ~ with text selected puts the marker on both sides of it, so selecting a word and typing ** makes it bold.',
      value: () => (ed.config.typing.pairMarkdown ? 'on' : 'off'),
      change: () => ed.updateConfig({ typing: { ...ed.config.typing, pairMarkdown: !ed.config.typing.pairMarkdown } }),
    },
    {
      label: 'PDF theme',
      tip: 'The colours a note is printed or saved as a PDF in (\\pdf, ctrl+p). Paper suits printing; any theme works.',
      value: () => ed.config.pdf.theme,
      change: (d) => {
        const ts = allThemes(ed.config);
        const i = ts.indexOf(ed.config.pdf.theme);
        ed.updateConfig({ pdf: { ...ed.config.pdf, theme: ts[(i + d + ts.length) % ts.length] } });
      },
    },
    {
      label: 'PDF paper',
      tip: 'The paper size for PDFs and printing.',
      value: () => ed.config.pdf.paper,
      change: () => ed.updateConfig({ pdf: { ...ed.config.pdf, paper: ed.config.pdf.paper === 'A4' ? 'Letter' : 'A4' } }),
    },
    {
      label: 'toolbar',
      tip: 'The bar along the top with notes, saving, math, drawing, find and PDF. Hidden, everything is still on its keys (F1) and in the \\ commands.',
      value: () => (ed.config.ui.toolbar ? 'shown' : 'hidden'),
      change: () => ed.toggleBar('toolbar'),
    },
    {
      label: 'toolbar while typing',
      tip: 'Fades: the toolbar disappears while you type and comes back when the mouse moves. Stays: always there.',
      value: () => (ed.config.ui.fadeToolbar ? 'fades' : 'stays'),
      change: () => ed.updateConfig({ ui: { ...ed.config.ui, fadeToolbar: !ed.config.ui.fadeToolbar } }),
    },
    {
      label: 'status bar',
      tip: 'The bar along the bottom: the mode, the keys for it, the note and its counts. Hidden, messages show for a moment in the corner.',
      value: () => (ed.config.ui.statusBar ? 'shown' : 'hidden'),
      change: () => ed.toggleBar('statusBar'),
    },
    { label: 'show tips', tip: 'Now and then, a short tip in the status bar about a faster way to do what you just did. Each tip shows at most twice.', value: () => (ed.config.tips ? 'on' : 'off'), change: () => ed.updateConfig({ tips: !ed.config.tips }) },
    { label: 'substitutions…', tip: 'Text replaced as you type, like -> with →. Turn groups of built-in substitutions on or off, and add your own.', act: () => openSubs(), hint: () => `${onCount()} on, ${mineCount()} custom` },
    { label: 'edit config file…', tip: 'All settings as JSON, including custom themes and extra CSS.', act: () => openEditor(), hint: 'themes, css' },
    ...(isDesktop()
      ? [{ label: 'open config in external editor', tip: 'Open the config file in your default editor. Changes apply when you come back to notex.', act: async () => { const p = await openConfigExternally(); if (p) ed.flash(`opened ${p}`); }, hint: '' } as Row]
      : []),
  ];

  let sel = $state(0);
  let text = $state('');
  let error = $state('');
  let area: HTMLTextAreaElement | undefined = $state();

  // ── substitutions ──
  type Kind = 'math' | 'text';
  type Mine = { kind: Kind; trigger: string; to: string };
  const mine = $derived<Mine[]>(
    (['math', 'text'] as const).flatMap((kind) => Object.entries(ed.config.snippets[kind]).map(([trigger, to]) => ({ kind, trigger, to }))),
  );
  // the list: the groups, your own, then the "add" line
  const subCount = $derived(SUB_GROUPS.length + mine.length + 1);
  let subSel = $state(0);
  /** The one being edited (null: adding a new one). */
  let editing = $state<Mine | null>(null);
  let form = $state<Mine>({ kind: 'math', trigger: '', to: '' });
  let formError = $state('');
  let triggerEl: HTMLInputElement | undefined = $state();
  let toEl: HTMLInputElement | undefined = $state();

  const same = (a: Mine | null, b: Mine) => !!a && a.kind === b.kind && a.trigger === b.trigger;

  function openSubs() {
    ed.settingsView = 'subs';
    subSel = 0;
  }

  function toggleGroup(id: string) {
    const s = ed.config.typing.substitutions;
    ed.updateConfig({ typing: { ...ed.config.typing, substitutions: { ...s, [id]: !s[id] } } });
  }

  async function startForm(m: Mine | null) {
    editing = m;
    form = m ? { ...m } : { kind: form.kind, trigger: '', to: '' };
    formError = '';
    subSel = m ? SUB_GROUPS.length + mine.indexOf(m) : subCount - 1;
    await tick();
    (m ? toEl : triggerEl)?.focus();
  }

  function withoutOld(sn: typeof ed.config.snippets, m: Mine | null) {
    const out = { math: { ...sn.math }, text: { ...sn.text } };
    if (m) delete out[m.kind][m.trigger];
    return out;
  }

  function saveForm() {
    const trigger = form.trigger.trim();
    if (!trigger) return void ((formError = 'enter a trigger'), triggerEl?.focus());
    if (/\s/.test(trigger)) return void ((formError = "triggers can't contain spaces"), triggerEl?.focus());
    if (!form.to) return void ((formError = 'enter a replacement'), toEl?.focus());
    const sn = withoutOld(ed.config.snippets, editing);
    sn[form.kind][trigger] = form.to;
    ed.updateConfig({ snippets: sn });
    ed.flash('substitution saved');
    editing = null;
    form = { kind: form.kind, trigger: '', to: '' };
    formError = '';
    triggerEl?.focus();
  }

  function remove(m: Mine) {
    ed.updateConfig({ snippets: withoutOld(ed.config.snippets, m) });
    if (same(editing, m)) editing = null;
    subSel = Math.min(subSel, subCount - 2);
  }

  function endForm() {
    editing = null;
    form = { kind: form.kind, trigger: '', to: '' };
    formError = '';
    (document.activeElement as HTMLElement | null)?.blur();
  }

  // ── the config text ──
  async function openEditor() {
    text = configToText($state.snapshot(ed.config) as typeof ed.config);
    error = '';
    ed.settingsEditing = true;
    await tick();
    area?.focus();
  }

  async function saveText() {
    const err = await ed.setConfigText(text);
    if (err) error = err;
    else {
      ed.settingsEditing = false;
      ed.flash('config saved');
    }
  }

  function close() {
    ed.showSettings = false;
    ed.settingsEditing = false;
    ed.settingsView = 'main';
  }

  function subsKey(e: KeyboardEvent) {
    const typing = e.target instanceof HTMLInputElement;
    if (typing) {
      if (e.key === 'Escape') endForm();
      else if (e.key === 'Enter' && e.target === triggerEl && !form.to) toEl?.focus();
      else if (e.key === 'Enter') saveForm();
      else return;
      e.preventDefault();
      return;
    }
    const g = SUB_GROUPS[subSel];
    const m = mine[subSel - SUB_GROUPS.length];
    switch (e.key) {
      case 'Escape': ed.settingsView = 'main'; break;
      case 'ArrowDown': subSel = (subSel + 1) % subCount; break;
      case 'ArrowUp': subSel = (subSel - 1 + subCount) % subCount; break;
      case 'ArrowLeft': case 'ArrowRight': case ' ': if (g) toggleGroup(g.id); break;
      case 'Enter': g ? toggleGroup(g.id) : startForm(m ?? null); break;
      case 'Delete': case 'Backspace': if (m) remove(m); break;
      case 'a': case 'n': startForm(null); break;
      default: return;
    }
    e.preventDefault();
  }

  function onKey(e: KeyboardEvent) {
    if (!ed.showSettings) return;
    if (ed.settingsEditing) {
      if (e.key === 'Escape') { ed.settingsEditing = false; e.preventDefault(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { saveText(); e.preventDefault(); }
      return;
    }
    if (ed.settingsView === 'subs') return subsKey(e);
    const r = rows[sel];
    switch (e.key) {
      case 'Escape': close(); break;
      case 'ArrowDown': sel = (sel + 1) % rows.length; break;
      case 'ArrowUp': sel = (sel - 1 + rows.length) % rows.length; break;
      case 'ArrowLeft': r.change?.(-1); break;
      case 'ArrowRight': r.change?.(1); break;
      case 'Enter': case ' ': r.act ? r.act() : r.change?.(1); break;
      default: return;
    }
    e.preventDefault();
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
    if (ed.settingsEditing) openEditor();
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onmousedown={(e) => e.target === e.currentTarget && close()}>
  <div class="panel" class:wide={ed.settingsEditing} class:mid={!ed.settingsEditing && ed.settingsView === 'subs'} transition:fly={{ y: 8, duration: 180, easing: cubicOut }}>
    {#if ed.settingsEditing}
      <div class="title">config</div>
      <textarea bind:this={area} bind:value={text} spellcheck="false"></textarea>
      {#if error}<div class="error" transition:fly={{ y: -4, duration: 150 }}>{error}</div>{/if}
      <div class="actions">
        <button onclick={() => (text = configToText(DEFAULT_CONFIG))}>reset to defaults</button>
        <span class="spacer"></span>
        <button onclick={() => (ed.settingsEditing = false)}>cancel{#if ed.input === 'keys'} <kbd>esc</kbd>{/if}</button>
        <button class="primary" onclick={saveText}>save{#if ed.input === 'keys'} <kbd>ctrl+⏎</kbd>{/if}</button>
      </div>
    {:else if ed.settingsView === 'subs'}
      <div class="title">
        <button class="back" onclick={() => (ed.settingsView = 'main')} data-tip="back to settings">‹</button>
        substitutions <span>· replace text as you type</span>
      </div>
      <div class="section">built-in <span>· math</span></div>
      {#each SUB_GROUPS as g, i}
        {@const on = !!ed.config.typing.substitutions[g.id]}
        <div class="row" class:sel={i === subSel} data-tip={g.desc} onmouseenter={() => (subSel = i)} onclick={() => toggleGroup(g.id)}>
          <span class="label">{g.label}</span>
          <span class="example">{g.example}</span>
          <span class="switch" class:on>{on ? 'on' : 'off'}</span>
        </div>
      {/each}
      <div class="section">custom</div>
      {#each mine as m, j (m.kind + m.trigger)}
        {@const i = SUB_GROUPS.length + j}
        <div class="row" class:sel={i === subSel} class:editing={same(editing, m)} data-tip={m.kind === 'math' ? 'In math, typing this inserts the LaTeX on the right. Click to edit.' : 'In text, typing this inserts the text on the right. Click to edit.'} onmouseenter={() => (subSel = i)} onclick={() => startForm(m)}>
          <span class="kind">{m.kind}</span>
          <span class="trigger">{m.trigger}</span>
          <span class="to">{m.to}</span>
          <button class="del" tabindex="-1" data-tip="remove" onclick={(e) => { e.stopPropagation(); remove(m); }}>×</button>
        </div>
      {/each}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="row form" class:sel={subSel === subCount - 1} onmouseenter={() => (subSel = subCount - 1)}>
        <button
          class="kind toggle"
          tabindex="-1"
          data-tip={form.kind === 'math' ? 'math: replacement is LaTeX, # marks the cursor' : 'text: plain text replacement'}
          onclick={() => (form.kind = form.kind === 'math' ? 'text' : 'math')}>{form.kind}</button
        >
        <input class="trigger" bind:this={triggerEl} bind:value={form.trigger} placeholder="trigger" data-tip="What you type to trigger it, without spaces" spellcheck="false" onfocus={() => (subSel = subCount - 1)} />
        <span class="arrow">→</span>
        <input class="to" bind:this={toEl} bind:value={form.to} placeholder="replacement" data-tip={form.kind === 'math' ? 'LaTeX to insert; # marks where the cursor goes' : 'Text to insert; may contain $math$'} spellcheck="false" />
        <button class="save" tabindex="-1" onclick={saveForm}>{editing ? 'save' : 'add'}</button>
      </div>
      {#if formError}<div class="error inset" transition:fly={{ y: -4, duration: 150 }}>{formError}</div>{/if}
      <div class="foot" class:hidden={ed.input === 'mouse'}>
        {#if subSel < SUB_GROUPS.length}↑↓ choose · ←→ switch · a add · esc back
        {:else if subSel < subCount - 1}↑↓ choose · ⏎ edit · del remove · esc back
        {:else}⏎ add · esc done{/if}
      </div>
    {:else}
      <div class="title">settings</div>
      {#each rows as r, i}
        <div class="row" class:sel={i === sel} data-tip={r.tip} onmouseenter={() => (sel = i)} onclick={() => (r.act ? r.act() : r.change?.(1))}>
          <span class="label">{r.label}</span>
          {#if r.value}
            <span class="value">
              <button tabindex="-1" onclick={(e) => { e.stopPropagation(); r.change?.(-1); }}>‹</button>
              {r.value()}
              <button tabindex="-1" onclick={(e) => { e.stopPropagation(); r.change?.(1); }}>›</button>
            </span>
          {:else}
            <span class="hint">{typeof r.hint === 'function' ? r.hint() : r.hint} {ed.input === 'mouse' ? '›' : '⏎'}</span>
          {/if}
        </div>
      {/each}
      <div class="foot" class:hidden={ed.input === 'mouse'}>↑↓ choose · ←→ change · esc close</div>
    {/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    background: var(--scrim);
    font-family: var(--mono);
    font-size: 12.5px;
    /* what you type, as typed: -> not an arrow ligature */
    font-variant-ligatures: none;
  }
  .panel {
    width: min(460px, 92vw);
    max-height: 88vh;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 0 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    transition: width 220ms cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  .panel.mid { width: min(600px, 94vw); }
  .panel.wide {
    width: min(760px, 94vw);
    padding: 16px 16px 12px;
  }
  .title {
    color: var(--accent);
    font-weight: 700;
    font-size: 14px;
    padding: 0 18px 10px;
  }
  .wide .title { padding: 0 2px 10px; }
  .title span { color: var(--muted); font-weight: 400; font-size: 11.5px; }
  .back {
    background: none;
    border: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
    padding: 0 6px 0 0;
  }
  .back:hover { color: var(--accent); }
  .section {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 10px 18px 4px;
  }
  .section span { text-transform: none; letter-spacing: 0; }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 6px 18px;
    cursor: pointer;
    color: var(--fg);
    border-left: 2px solid transparent;
    transition: background-color 100ms ease, border-color 100ms ease;
  }
  .row.sel {
    background: var(--sel-bg);
    border-left-color: var(--accent);
  }
  .row.sel .label { color: var(--accent); }
  .row.editing { opacity: 0.45; }
  .label { white-space: nowrap; }
  .example { flex: 1; color: var(--muted); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .switch { width: 3ch; text-align: right; color: var(--muted); }
  .switch.on { color: var(--accent); }
  .kind { width: 4ch; color: var(--muted); font-size: 11px; }
  .trigger { width: 12ch; color: var(--accent); }
  .to { flex: 1; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .arrow { color: var(--muted); }
  .del {
    background: none;
    border: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
    opacity: 0;
    transition: opacity 100ms ease;
  }
  .row.sel .del { opacity: 1; }
  .del:hover { color: var(--danger); }
  .form { cursor: default; }
  .form input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 6px;
    font: inherit;
    outline: none;
    min-width: 0;
  }
  .form input:focus { border-color: var(--accent); }
  .form input::placeholder { color: var(--muted); opacity: 0.7; }
  .form .trigger { flex: none; }
  .toggle {
    background: none;
    border: 1px dashed var(--border);
    border-radius: 4px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    padding: 2px 0;
    width: 5ch;
  }
  .toggle:hover { color: var(--accent); border-color: var(--accent); }
  .save {
    background: none;
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 4px;
    padding: 2px 10px;
    font: inherit;
    cursor: pointer;
  }
  .save:hover { border-color: var(--accent); color: var(--accent); }
  .value { display: flex; align-items: center; gap: 8px; }
  .value button {
    background: none;
    border: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
    padding: 0 4px;
  }
  .value button:hover { color: var(--accent); }
  .hint { color: var(--muted); }
  .foot { color: var(--muted); padding: 10px 18px 0; font-size: 11px; }
  textarea {
    width: 100%;
    height: min(60vh, 520px);
    resize: vertical;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    font: 12.5px/1.55 var(--mono);
    outline: none;
    tab-size: 2;
  }
  textarea:focus { border-color: var(--accent); }
  .error { color: var(--danger); padding: 6px 2px 0; }
  .error.inset { padding: 4px 18px 0; }
  .actions { display: flex; gap: 8px; padding-top: 10px; align-items: center; }
  .spacer { flex: 1; }
  .actions button {
    background: none;
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 4px;
    padding: 4px 10px;
    font: inherit;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease;
  }
  .actions button:hover { border-color: var(--accent); color: var(--accent); }
  .actions .primary { border-color: var(--accent); color: var(--accent); }
  kbd { font: inherit; color: var(--muted); margin-left: 4px; }
  /* (the keys, for those using keys: with the mouse the rows are clicked) */
  .foot.hidden { visibility: hidden; }
</style>
