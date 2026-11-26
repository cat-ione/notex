<script lang="ts">
  // While drawing: the tools, the style (colour, width, dashes, fill) and done, in a bar at the
  // top of the page. Every button shows its key when hovered. Big enough for a finger on a
  // touch screen.
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { Editor } from '$lib/editor.svelte';
  import { INKS, inkVar } from '$lib/marks';
  import { TOOLS, type Tool } from '$lib/sketch/sketcher.svelte';
  import { WIDTHS, isBox } from '$lib/sketch/shapes';

  let { ed }: { ed: Editor } = $props();
  const sk = $derived(ed.sketch);

  // the style shown: the selected shape's, else what new shapes get
  const one = $derived(sk.selected.length === 1 ? sk.selected[0] : null);
  const color = $derived(one ? (one.color ?? '') : sk.color);
  const width = $derived(one ? (one.width ?? 2) : sk.width);
  const dash = $derived(one ? !!one.dash : sk.dash);
  const fill = $derived(one ? isBox(one) && !!one.fill : sk.fill);

  const down = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const act = (f: () => void) => (e: Event) => {
    down(e);
    f();
    ed.touch();
  };
  const NAMES: Record<Tool, string> = { select: 'select', pen: 'pen', marker: 'highlighter', line: 'line', arrow: 'arrow', rect: 'box', ellipse: 'ellipse', diamond: 'diamond', text: 'text', plot: 'graph', eraser: 'eraser' };
  const where = $derived(sk.on?.kind === 'block' ? 'diagram' : 'on the note');
  const fingers = $derived(ed.config.sketch.touch);
</script>

{#snippet icon(t: Tool)}
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    {#if t === 'select'}<path d="M4,2 L4,13 L7,10 L9.5,14.5 L11,13.7 L8.6,9.3 L12.5,9 Z" />
    {:else if t === 'pen'}<path d="M2.5,13.5 C5,9 7,12 9,8 S12,4 13.5,2.5" />
    {:else if t === 'marker'}<path class="fill" d="M3,13 L5,9 L11,3 L13,5 L7,11 Z" /><line x1="2" y1="14.5" x2="9" y2="14.5" />
    {:else if t === 'line'}<line x1="2.5" y1="13.5" x2="13.5" y2="2.5" />
    {:else if t === 'arrow'}<line x1="2.5" y1="13.5" x2="13" y2="3" /><path d="M7.5,3 L13,3 L13,8.5" />
    {:else if t === 'rect'}<rect x="2" y="4" width="12" height="8" rx="1.5" />
    {:else if t === 'ellipse'}<ellipse cx="8" cy="8" rx="6" ry="4.5" />
    {:else if t === 'diamond'}<path d="M8,2 L14,8 L8,14 L2,8 Z" />
    {:else if t === 'text'}<path d="M3,4 V3 H13 V4 M8,3 V13 M6,13 H10" />
    {:else if t === 'plot'}<path d="M2,8 H14 M8,2 V14" class="thin" /><path d="M2.5,12.5 C5,12 6,3.5 8,3.5 S11,12 13.5,12.5" />
    {:else}<path d="M6,13.5 H14 M3,10.5 L8.5,5 L12,8.5 L8,12.5 L5,12.5 Z" />{/if}
  </svg>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sbar" class:low={!ed.config.ui.toolbar} onpointerdown={down} onmousedown={down} transition:fly={{ y: -6, duration: 140, easing: cubicOut }}>
  <span class="where">{where}</span>
  <div class="group">
    {#each TOOLS as t (t.tool)}
      <button class:on={sk.tool === t.tool} data-tip={t.desc} data-tip-key={t.num ? `${t.key} / ${t.num}` : t.key} aria-label={NAMES[t.tool]} onpointerdown={act(() => ((sk.tool = t.tool), t.tool !== 'select' && (sk.sel = [])))}>{@render icon(t.tool)}</button>
    {/each}
  </div>
  <div class="group">
    {#each INKS as c (c)}
      <button class="ink" class:on={color === c} data-tip="{c || 'text'} colour" data-tip-key="c / shift+c" aria-label="{c || 'text'} colour" onpointerdown={act(() => sk.restyle({ color: c }))}>
        <span style="background: {c ? inkVar(c) : 'var(--fg)'}"></span>
      </button>
    {/each}
  </div>
  <div class="group">
    {#each WIDTHS as w (w)}
      <button class:on={width === w} data-tip={['thin', 'normal', 'bold'][w - 1]} data-tip-key="w" aria-label="{['thin', 'normal', 'bold'][w - 1]} lines" onpointerdown={act(() => sk.restyle({ width: w }))}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><line x1="3" y1="8" x2="13" y2="8" style="stroke-width: {[1, 2, 3.5][w - 1]}" /></svg>
      </button>
    {/each}
    <button class:on={dash} data-tip="dashed" data-tip-key="-" aria-label="dashed" onpointerdown={act(() => sk.restyle({ dash: !dash }))}>┄</button>
    <button class:on={fill} data-tip="filled (boxes, ellipses, diamonds)" data-tip-key="f" aria-label="filled" onpointerdown={act(() => sk.restyle({ fill: !fill }))}>
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect class="fill" x="3" y="4" width="10" height="8" rx="1.5" /></svg>
    </button>
  </div>
  <div class="group">
    <button data-tip="undo" data-tip-key="ctrl+z" aria-label="undo" onpointerdown={act(() => ed.undo())}>↶</button>
    <button data-tip="redo" data-tip-key="ctrl+y" aria-label="redo" onpointerdown={act(() => ed.redo())}>↷</button>
    <button class="danger" disabled={!sk.sel.length} data-tip="delete the selection" data-tip-key="del" aria-label="delete" onpointerdown={act(() => sk.removeSelected())}>✕</button>
  </div>
  {#if sk.penSeen || matchMedia('(pointer: coarse)').matches}
    <div class="group">
      <!-- (fingers: draw, or scroll and leave the drawing to the pen) -->
      <button class:on={sk.touchDraws} data-tip={sk.touchDraws ? 'fingers draw (tap to make them scroll)' : 'fingers scroll (tap to make them draw)'} aria-label="fingers draw" onpointerdown={act(() => ed.updateConfig({ sketch: { ...ed.config.sketch, touch: sk.touchDraws ? 'scroll' : 'draw' } }))}>
        ☝{#if fingers === 'auto'}<span class="auto">a</span>{/if}
      </button>
    </div>
  {/if}
  <button class="done" data-tip="back to the text" data-tip-key="esc" onpointerdown={act(() => sk.exit())}>done</button>
</div>

<style>
  .sbar {
    position: absolute;
    top: 38px;
    left: 50%;
    z-index: 30;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    font-family: var(--mono);
    font-size: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 7px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    white-space: nowrap;
    user-select: none;
    touch-action: none;
    max-width: calc(100vw - 16px);
    overflow-x: auto;
  }
  .sbar.low {
    top: 8px;
  }
  .where {
    padding: 0 8px 0 6px;
    color: var(--mode-arrow);
    letter-spacing: 0.04em;
  }
  .group {
    display: flex;
    gap: 1px;
    padding-left: 3px;
    border-left: 1px solid var(--border);
  }
  button {
    display: grid;
    place-items: center;
    position: relative;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
    transition: background-color 80ms ease, color 80ms ease;
  }
  button:hover:not(:disabled) {
    background: var(--sel-bg);
    color: var(--fg);
  }
  button.on {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  button.danger:hover:not(:disabled) {
    color: var(--ink-red);
  }
  button.done {
    width: auto;
    margin-left: 4px;
    padding: 0 10px;
    color: var(--fg);
    border: 1px solid var(--border);
  }
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  svg .fill {
    fill: currentColor;
    fill-opacity: 0.35;
  }
  svg .thin {
    stroke-width: 0.8;
    opacity: 0.6;
  }
  .ink span {
    width: 11px;
    height: 11px;
    border-radius: 50%;
  }
  .ink.on {
    background: var(--sel-bg);
  }
  .ink.on span {
    box-shadow: 0 0 0 2px var(--panel), 0 0 0 3px currentColor;
  }
  .auto {
    position: absolute;
    right: 2px;
    bottom: 1px;
    font-size: 8px;
  }
  /* a finger: bigger targets */
  @media (pointer: coarse) {
    button {
      width: 36px;
      height: 36px;
    }
    .sbar {
      top: 40px;
    }
  }
</style>
