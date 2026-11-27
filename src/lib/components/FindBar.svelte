<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { Editor } from '$lib/editor.svelte';

  // Find (Ctrl+F): a small bar over the page. Enter / Shift+Enter (or F3) go through the
  // matches, which are highlighted on the page; Esc closes it with the match selected.
  // Ctrl+H adds a replace field: Enter there replaces the match and goes on, Ctrl+Alt+Enter
  // replaces them all.
  let { ed }: { ed: Editor } = $props();

  let input = $state<HTMLInputElement>();
  let withInput = $state<HTMLInputElement>();
  $effect(() => {
    ed.finder.findFocus;
    if (ed.find && input) {
      input.focus();
      input.select();
    }
  });
  // closed: let go of the keys at once (the bar stays a moment for its exit animation)
  $effect(() => {
    if (!ed.find) input?.blur();
  });

  const n = $derived(ed.finder.findMatches.length);

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      ed.finder.closeFind();
    } else if (e.key === 'Enter' || e.key === 'F3') {
      e.preventDefault();
      ed.finder.findGo(e.shiftKey ? -1 : 1);
    } else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      input?.select();
    } else if (e.key === 'h' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (ed.find) ed.find.replace = true;
      requestAnimationFrame(() => withInput?.select());
    }
  }

  function replaceKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.altKey) {
      e.preventDefault();
      ed.finder.replaceAll();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      ed.finder.replaceOne();
    } else key(e);
  }
</script>

{#if ed.find}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- (under the menu bar, and under the drawing bar while drawing) -->
  <div class="findbar" style:top="{(ed.config.ui.toolbar ? 40 : 10) + (ed.sketch.active ? 44 : 0)}px" transition:fly={{ y: -6, duration: 130, easing: cubicOut }} onmousedown={(e) => e.stopPropagation()}>
    <div class="row">
      <span class="sigil">/</span>
      <input
        bind:this={input}
        value={ed.find.q}
        oninput={(e) => ed.finder.setFindQuery(e.currentTarget.value)}
        onkeydown={key}
        placeholder="find"
        spellcheck="false"
      />
      <span class="count" class:none={ed.find.q && !n}>{ed.find.q ? (n ? `${ed.find.i + 1}/${n}` : 'none') : ''}</span>
      <button data-tip="previous" data-tip-key="shift+enter" onclick={() => ed.finder.findGo(-1)} disabled={!n}>↑</button>
      <button data-tip="next" data-tip-key="enter / F3" onclick={() => ed.finder.findGo(1)} disabled={!n}>↓</button>
      <button data-tip="replace" data-tip-key="ctrl+h" class:on={ed.find.replace} onclick={() => ed.find && ((ed.find.replace = !ed.find.replace), ed.find.replace && requestAnimationFrame(() => withInput?.focus()))}>⇄</button>
      <button data-tip="close" data-tip-key="esc" onclick={() => ed.finder.closeFind()}>✕</button>
    </div>
    {#if ed.find.replace}
      <div class="with">
        <span class="sigil">→</span>
        <input
          bind:this={withInput}
          value={ed.find.with ?? ''}
          oninput={(e) => ed.finder.setReplaceText(e.currentTarget.value)}
          onkeydown={replaceKey}
          placeholder="replace with"
          spellcheck="false"
          aria-label="replace with"
        />
        <button class="word" data-tip="replace this one, then the next" data-tip-key="enter" onclick={() => ed.finder.replaceOne()} disabled={!n}>replace</button>
        <button class="word" data-tip="replace them all" data-tip-key="ctrl+alt+enter" onclick={() => ed.finder.replaceAll()} disabled={!n}>all</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .findbar {
    position: absolute;
    top: 10px;
    right: 18px;
    z-index: 25;
    /* (a row each, as wide as the wider: the replace row under find, not beside it) */
    display: flex;
    flex-direction: column;
    max-width: calc(100% - 36px);
    padding: 4px 6px 4px 10px;
    font-family: var(--mono);
    font-size: 12.5px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .row,
  .with {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .sigil {
    color: var(--accent);
  }
  input {
    width: 200px;
    padding: 2px 4px;
    border: 0;
    outline: none;
    background: none;
    color: var(--fg);
    font: inherit;
  }
  input::placeholder {
    color: var(--muted);
  }
  .count {
    min-width: 44px;
    text-align: right;
    color: var(--muted);
    font-size: 11.5px;
  }
  .count.none {
    color: var(--ink-red);
  }
  button {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--sel-bg);
    color: var(--fg);
  }
  button.on {
    color: var(--accent);
  }
  .with {
    padding-top: 3px;
    margin-top: 3px;
    border-top: 1px solid var(--border);
  }
  button.word {
    width: auto;
    padding: 0 6px;
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
