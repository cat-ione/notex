<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { keyLabel, type Editor } from '$lib/editor.svelte';
  import { INKS, MARK_KINDS, inkVar } from '$lib/marks';

  // A small toolbar over the selected drawing: one click for what its menu (and its keys)
  // can do. The tooltips name the key for each, and the wheel shortcuts.
  let { ed }: { ed: Editor } = $props();

  const at = $derived(ed.barAt);
  const id = $derived(ed.styling);
  const mark = $derived(id ? ed.doc.marks.find((m) => m.id === id) : undefined);
  const arrow = $derived(id ? ed.doc.arrows.find((a) => a.id === id) : undefined);
  const acts = $derived(id && at ? ed.drawingActions(id) : []);
  const tip = (name: string, extra = '') => {
    const a = acts.find((x) => x.name === name);
    return a ? `${a.desc} · ${keyLabel(a.keys[0])}${extra}` : '';
  };
  const down = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  // the arrowheads button shows what it is now
  const HEADS = { end: '→', both: '↔', none: '—' } as const;
</script>

{#snippet kindIcon(k: string)}
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    {#if k === 'box'}<rect x="2" y="3.5" width="12" height="9" rx="1.5" />
    {:else if k === 'circle'}<ellipse cx="8" cy="8" rx="6" ry="4.6" />
    {:else if k === 'underline'}<text x="8" y="10" text-anchor="middle">a</text><line x1="2.5" y1="13" x2="13.5" y2="13" />
    {:else if k === 'highlight'}<rect class="fill" x="2" y="4" width="12" height="8" rx="1" /><text x="8" y="10.5" text-anchor="middle">a</text>
    {:else if k === 'brace'}<path d="M2,5 Q2,8 5,8 H6.5 Q8,8 8,11 Q8,8 9.5,8 H11 Q14,8 14,5" />
    {:else}<text x="8" y="11" text-anchor="middle">a</text><line x1="2.5" y1="8.5" x2="13.5" y2="8.5" />{/if}
  </svg>
{/snippet}

{#if at && id && (mark || arrow)}
  {@const d = mark ?? arrow!}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dbar"
    class:below={at.below}
    style="left: {at.x}px; top: {at.y}px;"
    onmousedown={down}
    oncontextmenu={(e) => { e.preventDefault(); ed.openDrawingMenu(id, e.clientX, e.clientY); }}
    transition:fly={{ y: at?.below ? -4 : 4, duration: 120, easing: cubicOut }}
  >
    {#if mark}
      <div class="group">
        {#each MARK_KINDS as k (k)}
          <button class:on={mark.kind === k} title="{k} · t / shift+t cycle · wheel over it" onclick={() => ed.setMarkKind(id, k)}>{@render kindIcon(k)}</button>
        {/each}
      </div>
    {:else if arrow}
      <div class="group">
        <button class="txt" title={tip('heads')} onclick={() => ed.runAction(id, 'heads')}>{HEADS[arrow.head]}</button>
        <button class="txt" title={tip('reverse')} onclick={() => ed.runAction(id, 'reverse')}>⇄</button>
        <button class="txt" class:on={arrow.bend === 0} title={tip('straight', ' · wheel over it bends')} onclick={() => ed.runAction(id, 'straight')}>⌒</button>
        <button class="txt" class:on={arrow.boxed} title={tip('boxes')} onclick={() => ed.runAction(id, 'boxes')}>▢</button>
      </div>
    {/if}
    <div class="group">
      {#each INKS as c (c)}
        <button class="ink" class:on={(d.color ?? '') === c} title="{c || 'default'} colour · c cycles · shift+wheel over it" onclick={() => ed.setInk(id, c)}>
          <span style="background: {inkVar(c)}"></span>
        </button>
      {/each}
    </div>
    <div class="group">
      <button class="txt" class:on={d.dash} title={tip('dash')} onclick={() => ed.runAction(id, 'dash')}>┄</button>
      <button class="txt" title="{tip('note')} · or double-click" onclick={() => ed.runAction(id, 'note')}>✎</button>
      {#if mark}
        <button class="txt" title="{tip('target')} · or drag the shape onto it" onclick={() => ed.runAction(id, 'target')}>⌖</button>
      {:else}
        <button class="txt" title="{tip('start')} · or drag its start dot" onclick={() => ed.runAction(id, 'start')}>⇤</button>
        <button class="txt" title="{tip('tip')} · or drag its tip dot" onclick={() => ed.runAction(id, 'tip')}>⇥</button>
      {/if}
      <button class="txt danger" title="{tip('delete')} · or middle-click it" onclick={() => ed.deleteDrawing(id)}>✕</button>
    </div>
  </div>
{/if}

<style>
  .dbar {
    position: absolute;
    z-index: 7;
    transform: translate(-50%, -100%);
    display: flex;
    gap: 2px;
    padding: 2px;
    font-family: var(--mono);
    font-size: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
    white-space: nowrap;
    user-select: none;
  }
  .dbar.below {
    transform: translate(-50%, 0);
  }
  .group {
    display: flex;
    gap: 1px;
  }
  .group + .group {
    border-left: 1px solid var(--border);
    padding-left: 2px;
  }
  button {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
    transition: background-color 80ms ease, color 80ms ease;
  }
  button:hover {
    background: var(--sel-bg);
    color: var(--fg);
  }
  button.on {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  button.danger:hover {
    color: var(--ink-red);
  }
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
  }
  svg text {
    fill: currentColor;
    stroke: none;
    font-size: 9px;
    font-family: var(--mono);
  }
  svg .fill {
    fill: currentColor;
    opacity: 0.3;
    stroke: none;
  }
  .ink span {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .ink.on {
    background: var(--sel-bg);
  }
  .ink.on span {
    box-shadow: 0 0 0 2px var(--panel), 0 0 0 3px currentColor;
  }
</style>
