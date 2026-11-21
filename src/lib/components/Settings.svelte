<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { Editor } from '$lib/editor.svelte';
  import { configToText, DEFAULT_CONFIG, openConfigExternally } from '$lib/config';
  import { isDesktop } from '$lib/files';

  let { ed }: { ed: Editor } = $props();

  type Row = { label: string; value?: () => string; change?: (dir: 1 | -1) => void; act?: () => void; hint?: string };

  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const rows: Row[] = [
    { label: 'theme', value: () => ed.config.theme, change: (d) => ed.cycleTheme(d) },
    { label: 'text size', value: () => `${ed.config.fontSize}px`, change: (d) => ed.updateConfig({ fontSize: clamp(ed.config.fontSize + d, 11, 28) }) },
    { label: 'page width', value: () => `${ed.config.pageWidth}px`, change: (d) => ed.updateConfig({ pageWidth: clamp(ed.config.pageWidth + d * 40, 480, 1600) }) },
    {
      label: 'math ^ and _',
      value: () => (ed.config.typing.latexScripts ? 'one thing, like LaTeX' : 'stay in until space'),
      change: () => ed.updateConfig({ typing: { ...ed.config.typing, latexScripts: !ed.config.typing.latexScripts } }),
    },
    {
      label: 'x^2 in text becomes math',
      value: () => (ed.config.typing.autoMath ? 'on' : 'off'),
      change: () => ed.updateConfig({ typing: { ...ed.config.typing, autoMath: !ed.config.typing.autoMath } }),
    },
    { label: 'tips now and then', value: () => (ed.config.tips ? 'on' : 'off'), change: () => ed.updateConfig({ tips: !ed.config.tips }) },
    { label: 'snippets, themes & css…', act: () => openEditor(), hint: 'edit the config' },
    ...(isDesktop()
      ? [{ label: 'open config in my editor', act: async () => { const p = await openConfigExternally(); if (p) ed.flash(`opened ${p} — changes load when you come back`); }, hint: 'external' } as Row]
      : []),
  ];

  let sel = $state(0);
  let text = $state('');
  let error = $state('');
  let area: HTMLTextAreaElement | undefined = $state();

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
  }

  function onKey(e: KeyboardEvent) {
    if (!ed.showSettings) return;
    if (ed.settingsEditing) {
      if (e.key === 'Escape') { ed.settingsEditing = false; e.preventDefault(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { saveText(); e.preventDefault(); }
      return;
    }
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
  <div class="panel" class:wide={ed.settingsEditing} transition:fly={{ y: 8, duration: 180, easing: cubicOut }}>
    {#if !ed.settingsEditing}
      <div class="title">settings</div>
      {#each rows as r, i}
        <div class="row" class:sel={i === sel} onmouseenter={() => (sel = i)} onclick={() => (r.act ? r.act() : r.change?.(1))}>
          <span class="label">{r.label}</span>
          {#if r.value}
            <span class="value">
              <button tabindex="-1" onclick={(e) => { e.stopPropagation(); r.change?.(-1); }}>‹</button>
              {r.value()}
              <button tabindex="-1" onclick={(e) => { e.stopPropagation(); r.change?.(1); }}>›</button>
            </span>
          {:else}
            <span class="hint">{r.hint} ⏎</span>
          {/if}
        </div>
      {/each}
      <div class="foot">↑↓ choose · ←→ change · esc close</div>
    {:else}
      <div class="title">config <span>· snippets: <code>"trigger": "LaTeX with # for the caret"</code></span></div>
      <textarea bind:this={area} bind:value={text} spellcheck="false"></textarea>
      {#if error}<div class="error" transition:fly={{ y: -4, duration: 150 }}>{error}</div>{/if}
      <div class="actions">
        <button onclick={() => (text = configToText(DEFAULT_CONFIG))}>reset to defaults</button>
        <span class="spacer"></span>
        <button onclick={() => (ed.settingsEditing = false)}>cancel <kbd>esc</kbd></button>
        <button class="primary" onclick={saveText}>save <kbd>ctrl+⏎</kbd></button>
      </div>
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
  }
  .panel {
    width: min(460px, 92vw);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 0 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    transition: width 220ms cubic-bezier(0.2, 0.9, 0.3, 1);
  }
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
  code { color: var(--fg); }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
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
</style>
