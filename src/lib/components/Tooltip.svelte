<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { Editor } from '$lib/editor.svelte';

  // One tooltip for the whole app, in place of the browser's. Anything with `data-tip`
  // gets it: the text, `data-tip-key` the keys that do the same ("t / shift+t"), and
  // `data-tip-more` a quieter second line. It waits a moment before showing, then follows
  // straight on from one control to the next while it's up.
  let { ed }: { ed: Editor } = $props();

  type Tip = { text: string; keys: string[]; more: string; r: DOMRect };
  let tip = $state<Tip | null>(null);
  let el = $state<HTMLDivElement>();
  let target: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastHidden = 0;

  const read = (t: Element): Tip | null => {
    const h = t as HTMLElement | SVGElement;
    const text = h.dataset.tip;
    if (!text) return null;
    const keys = (h.dataset.tipKey ?? '').split(' / ').filter(Boolean);
    return { text, keys, more: h.dataset.tipMore ?? '', r: t.getBoundingClientRect() };
  };

  const hide = () => {
    clearTimeout(timer);
    if (tip) lastHidden = performance.now();
    tip = null;
    target = null;
  };

  onMount(() => {
    const over = (e: PointerEvent) => {
      const t = (e.target as Element | null)?.closest?.('[data-tip]') ?? null;
      if (t === target) return;
      clearTimeout(timer);
      if (!t) return hide();
      target = t;
      // straight on from another tooltip; otherwise after a moment
      const warm = !!tip || performance.now() - lastHidden < 400;
      if (tip) tip = null;
      timer = setTimeout(() => {
        if (target === t && t.isConnected) tip = read(t);
      }, warm ? 0 : 450);
    };
    const opts = { capture: true, passive: true };
    document.addEventListener('pointerover', over, opts);
    document.addEventListener('pointerdown', hide, opts);
    document.addEventListener('wheel', hide, opts);
    document.addEventListener('keydown', hide, opts);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', over, opts);
      document.removeEventListener('pointerdown', hide, opts);
      document.removeEventListener('wheel', hide, opts);
      document.removeEventListener('keydown', hide, opts);
      window.removeEventListener('blur', hide);
      clearTimeout(timer);
    };
  });

  // gone with what it points at, and out of the way of a drag
  $effect(() => {
    if (ed.dragBusy) hide();
  });

  // above the control, or below when there's no room; kept inside the window
  const pos = $derived.by(() => {
    if (!tip) return { x: 0, y: 0, below: false };
    const w = el?.offsetWidth ?? 160, h = el?.offsetHeight ?? 24;
    const below = tip.r.top - h - 8 < 4;
    const x = Math.max(4, Math.min(tip.r.left + tip.r.width / 2 - w / 2, window.innerWidth - w - 4));
    return { x, y: below ? tip.r.bottom + 7 : tip.r.top - h - 7, below };
  });
</script>

{#if tip}
  <div class="tip" class:below={pos.below} bind:this={el} style="left: {pos.x}px; top: {pos.y}px;" role="tooltip" in:fade={{ duration: 90 }}>
    <div class="main">
      <span>{tip.text}</span>
      {#each tip.keys as k (k)}<kbd>{k}</kbd>{/each}
    </div>
    {#if tip.more}<div class="more">{tip.more}</div>{/if}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 40;
    width: max-content;
    font-variant-ligatures: none; /* keys as typed: -> not an arrow */
    max-width: 320px;
    padding: 4px 8px;
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--fg);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 5px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  kbd { white-space: nowrap; }
  .main {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  kbd {
    padding: 0 4px;
    font-family: inherit;
    font-size: 10.5px;
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    border-radius: 3px;
  }
  .more {
    color: var(--muted);
    white-space: normal;
  }
</style>
