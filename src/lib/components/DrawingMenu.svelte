<script lang="ts">
  import { fly } from 'svelte/transition';
  import { mouseMoved } from '$lib/geom';
  import { cubicOut } from 'svelte/easing';
  import { keyLabel, type Editor } from '$lib/editor.svelte';

  // The right-click menu: a drawing's actions (Shift+F10 opens it from the keyboard), or
  // the page's (clipboard, drawing on the selection, undo). Each entry shows its key; its
  // tooltip, any other way to do it.
  let { ed }: { ed: Editor } = $props();

  let el = $state<HTMLDivElement>();
  // kept inside the window
  const pos = $derived.by(() => {
    const m = ed.menus.menu;
    if (!m) return { x: 0, y: 0 };
    const w = el?.offsetWidth ?? 240, h = el?.offsetHeight ?? 300;
    return { x: Math.max(4, Math.min(m.x, window.innerWidth - w - 4)), y: Math.max(4, Math.min(m.y, window.innerHeight - h - 4)) };
  });
</script>

{#if ed.menus.menu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dmenu"
    bind:this={el}
    style="left: {pos.x}px; top: {pos.y}px;"
    onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); }}
    oncontextmenu={(e) => e.preventDefault()}
    transition:fly={{ y: -4, duration: 120, easing: cubicOut }}
  >
    {#each ed.menus.menuItems as a, i (a.name)}
      {#if a.sep && i > 0}<div class="rule"></div>{/if}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="opt"
        class:sel={i === ed.menus.menu.sel}
        class:off={a.off}
        class:danger={a.name === 'delete'}
        data-tip={a.more}
        onmousemove={(e) => mouseMoved(e) && ed.menus.menu && !a.off && ed.menus.menu.sel !== i && (ed.menus.menu.sel = i)}
        onclick={() => ed.menus.runMenu(i)}
      >
        <span class="name">{a.desc}</span><kbd>{keyLabel(a.keys[0])}</kbd>
      </div>
    {/each}
  </div>
{/if}

<style>
  .dmenu {
    position: fixed;
    z-index: 40;
    min-width: 220px;
    /* (as wide as its entries, even opened near the window's edge: it's moved in instead) */
    width: max-content;
    max-width: calc(100vw - 8px);
    padding: 4px 0;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.5;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
    user-select: none;
    /* (a short window: it scrolls, rather than running off the bottom) */
    max-height: calc(100vh - 8px);
    overflow-y: auto;
    box-sizing: border-box;
  }
  .opt {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding: 2px 10px;
    align-items: center;
    color: var(--fg);
    cursor: pointer;
  }
  kbd {
    padding: 0 4px;
    font-family: inherit;
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 3px;
  }
  .opt.sel kbd {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }
  .opt.off {
    opacity: 0.4;
    cursor: default;
  }
  .rule {
    height: 1px;
    margin: 4px 8px;
    background: var(--border);
  }
  .opt.sel {
    background: var(--sel-bg);
  }
  .opt.sel .name {
    color: var(--accent);
  }
  .opt.sel .name::before {
    content: '› ';
  }
  .opt.danger.sel .name {
    color: var(--ink-red, var(--accent));
  }
</style>
