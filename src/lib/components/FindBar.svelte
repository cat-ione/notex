<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { Editor } from '$lib/editor.svelte';

  // Find (Ctrl+F): a small bar over the page. Enter / Shift+Enter (or F3) go through the
  // matches, which are highlighted on the page; Esc closes it with the match selected.
  let { ed }: { ed: Editor } = $props();

  let input = $state<HTMLInputElement>();
  $effect(() => {
    ed.findFocus;
    if (ed.find && input) {
      input.focus();
      input.select();
    }
  });
  // closed: let go of the keys at once (the bar stays a moment for its exit animation)
  $effect(() => {
    if (!ed.find) input?.blur();
  });

  const n = $derived(ed.findMatches.length);

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      ed.closeFind();
    } else if (e.key === 'Enter' || e.key === 'F3') {
      e.preventDefault();
      ed.findGo(e.shiftKey ? -1 : 1);
    } else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      input?.select();
    }
  }
</script>

{#if ed.find}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="findbar" transition:fly={{ y: -6, duration: 130, easing: cubicOut }} onmousedown={(e) => e.stopPropagation()}>
    <span class="sigil">/</span>
    <input
      bind:this={input}
      value={ed.find.q}
      oninput={(e) => ed.setFindQuery(e.currentTarget.value)}
      onkeydown={key}
      placeholder="find"
      spellcheck="false"
    />
    <span class="count" class:none={ed.find.q && !n}>{ed.find.q ? (n ? `${ed.find.i + 1}/${n}` : 'none') : ''}</span>
    <button data-tip="previous" data-tip-key="shift+enter" onclick={() => ed.findGo(-1)} disabled={!n}>↑</button>
    <button data-tip="next" data-tip-key="enter / F3" onclick={() => ed.findGo(1)} disabled={!n}>↓</button>
    <button data-tip="close" data-tip-key="esc" onclick={() => ed.closeFind()}>✕</button>
  </div>
{/if}

<style>
  .findbar {
    position: absolute;
    top: 10px;
    right: 18px;
    z-index: 25;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px 4px 10px;
    font-family: var(--mono);
    font-size: 12.5px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
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
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
