<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { Editor } from '$lib/editor.svelte';

  // The outline (ctrl+shift+o): the note's headings and theorems down the side of the page.
  // A click goes there (unfolding what hides it); a heading's ▾ folds its section. The
  // section the caret is in is marked.
  let { ed }: { ed: Editor } = $props();

  const items = $derived(ed.outline);
  /** The entry the caret is under: the last one at or before its block. */
  const here = $derived.by(() => {
    let k = -1;
    for (let i = 0; i < items.length && items[i].b <= ed.b; i++) k = i;
    return k;
  });

  let list = $state<HTMLDivElement>();
  $effect(() => {
    void here;
    list?.querySelector('.item.here')?.scrollIntoView({ block: 'nearest' });
  });

  function go(e: MouseEvent, b: number) {
    e.preventDefault();
    ed.goToBlock(b);
  }
  function fold(e: MouseEvent, b: number) {
    e.preventDefault();
    e.stopPropagation();
    ed.toggleFold(b);
    ed.touch();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav class="outline" class:low={ed.config.ui.toolbar} transition:fly={{ x: -8, duration: 140, easing: cubicOut }} onmousedown={(e) => e.stopPropagation()} aria-label="outline">
  <div class="top">
    <span class="sigil">≡</span> outline
    <button class="close" data-tip="close" data-tip-key="ctrl+shift+o" onclick={() => ed.toggleOutline()}>✕</button>
  </div>
  <div class="list" bind:this={list}>
    {#each items as it, i (it.b)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="item" class:here={i === here} class:box={!!it.box} style:--lv={Math.min(it.level, 4) - 1} role="link" tabindex="-1" onmousedown={(e) => go(e, it.b)}>
        {#if !it.box && ed.sectionEnd(it.b) > it.b + 1}
          <span class="fold" class:folded={it.folded} role="button" tabindex="-1" onmousedown={(e) => fold(e, it.b)}></span>
        {:else}
          <span class="fold none"></span>
        {/if}
        <span class="text" class:h1={it.level === 1}>{it.text}</span>
      </div>
    {:else}
      <div class="empty">no headings yet: # at a line's start makes one</div>
    {/each}
  </div>
</nav>

<style>
  .outline {
    position: fixed;
    left: 12px;
    top: 12px;
    bottom: 40px;
    z-index: 20;
    width: 236px;
    display: flex;
    flex-direction: column;
    font-family: var(--mono);
    font-size: 12px;
    background: color-mix(in srgb, var(--panel) 92%, transparent);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    backdrop-filter: blur(6px);
  }
  .outline.low {
    top: 52px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 8px 6px 10px;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .sigil {
    color: var(--accent);
  }
  .close {
    margin-left: auto;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }
  .close:hover {
    background: var(--sel-bg);
    color: var(--fg);
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0 8px;
    scrollbar-width: thin;
  }
  .item {
    display: flex;
    align-items: baseline;
    gap: 2px;
    padding: 2px 8px 2px calc(4px + var(--lv) * 12px);
    color: var(--fg);
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  .item:hover {
    background: var(--sel-bg);
  }
  .item.here {
    border-left-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .item.box .text {
    color: var(--muted);
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .text.h1 {
    font-weight: 600;
    color: var(--heading);
  }
  .fold {
    flex: none;
    width: 14px;
    text-align: center;
    font-size: 10px;
    color: var(--muted);
  }
  .fold:not(.none)::after {
    content: '▾';
  }
  .fold.folded::after {
    content: '▸';
  }
  .fold:not(.none):hover {
    color: var(--accent);
  }
  .empty {
    padding: 8px 10px;
    color: var(--muted);
    line-height: 1.5;
  }
  @media (max-width: 700px) {
    .outline {
      width: min(236px, calc(100vw - 24px));
    }
  }
</style>
