<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { Editor } from '$lib/editor.svelte';

  // A ring of choices round the pen or finger (the pen's side button tapped, a finger held
  // down): the tools, or what can be done to what's selected. Tap one, or slide to it and
  // lift; tap the middle or away from the ring to close it. Which item a pointer is on comes
  // from where it is (its distance and angle from the middle), not from what's under it: a
  // finger keeps the element it went down on.
  let { ed }: { ed: Editor } = $props();

  const ITEM = 23;
  // (the last one shown, while it goes: it's gone from the editor already)
  let kept = untrack(() => ed.radial!);
  const m = $derived.by(() => (ed.radial ? (kept = ed.radial) : kept));
  const n = $derived(m.items.length);
  // (round enough for its items to sit apart)
  const R = $derived(Math.max(76, (n * 54) / (2 * Math.PI)));
  // (kept on the screen: a ring at the edge moves in)
  const cx = $derived(Math.max(R + ITEM + 8, Math.min(window.innerWidth - R - ITEM - 8, m.x)));
  const cy = $derived(Math.max(R + ITEM + 8, Math.min(window.innerHeight - R - ITEM - 8, m.y)));
  const at = (i: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  };
  /** The item at a point (nearest, if near enough), -1 for the middle, null for nothing. */
  function itemAt(x: number, y: number): number | null {
    const d = Math.hypot(x - cx, y - cy);
    if (d < 30) return -1;
    if (d > R + ITEM + 18) return null;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const p = at(i), e = Math.hypot(x - p.x, y - p.y);
      if (e < bd) (bd = e), (best = i);
    }
    return bd < ITEM + 20 ? best : null;
  }

  let hover = $state<number | null>(null);
  /** The press that opened the ring (lifting it in the middle leaves the ring open, to tap). */
  let opener = $state<number | null>(null);
  /** A press that started on the ring (its lift chooses). */
  let pressed = false;

  function pick(i: number | null) {
    if (i === null || i === -1) return ed.closeRadial();
    const it = m.items[i];
    if (!it || it.off) return;
    ed.pickRadial(it);
  }

  onMount(() => {
    opener = m.pointer ?? null;
    const move = (e: PointerEvent) => (hover = itemAt(e.clientX, e.clientY));
    const down = (e: PointerEvent) => {
      const i = itemAt(e.clientX, e.clientY);
      e.preventDefault();
      e.stopPropagation();
      if (i === null) return ed.closeRadial();
      pressed = true;
      hover = i;
    };
    const up = (e: PointerEvent) => {
      const i = itemAt(e.clientX, e.clientY);
      // the press that opened it, lifted in the middle (or nowhere): stay, to be tapped
      if (e.pointerId === opener) {
        opener = null;
        if (i === -1 || i === null) return;
      } else if (!pressed) return;
      pressed = false;
      e.preventDefault();
      e.stopPropagation();
      pick(i);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), ed.closeRadial());
    };
    // (before the page sees them: the ring is on top of everything)
    const o = { capture: true, passive: false };
    window.addEventListener('pointermove', move, o);
    window.addEventListener('pointerdown', down, o);
    window.addEventListener('pointerup', up, o);
    window.addEventListener('keydown', key, o);
    return () => {
      window.removeEventListener('pointermove', move, o);
      window.removeEventListener('pointerdown', down, o);
      window.removeEventListener('pointerup', up, o);
      window.removeEventListener('keydown', key, o);
    };
  });

  const shown = $derived(hover !== null && hover >= 0 ? m.items[hover]?.label : m.title);
</script>

<div class="radial" style="left: {cx}px; top: {cy}px; --rr: {R + ITEM + 8}px" transition:scale={{ start: 0.6, duration: 140, easing: cubicOut }} role="menu" aria-label={m.title}>
  <div class="ring"></div>
  <div class="middle" class:hot={hover === -1}><span>{shown ?? ''}</span></div>
  {#each m.items as it, i (it.label)}
    {@const p = at(i)}
    <div
      class="item"
      class:hot={hover === i}
      class:on={it.on}
      class:off={it.off}
      style="left: {p.x - cx}px; top: {p.y - cy}px; {it.color ? `--dot: ${it.color}` : ''}"
      role="menuitem"
      aria-label={it.label}
    >
      {#if it.color}<span class="dot"></span>{:else}{it.icon}{/if}
    </div>
  {/each}
</div>

<style>
  .radial {
    position: fixed;
    z-index: 60;
    width: 0;
    height: 0;
    font-family: var(--mono);
    touch-action: none;
    user-select: none;
  }
  .ring {
    position: absolute;
    left: calc(var(--rr) * -1);
    top: calc(var(--rr) * -1);
    width: calc(var(--rr) * 2);
    height: calc(var(--rr) * 2);
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--panel) 70%, transparent) 0 40%, color-mix(in srgb, var(--panel) 88%, transparent) 41% 70%, transparent 71%);
    border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(4px);
  }
  .middle {
    position: absolute;
    left: -30px;
    top: -30px;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    text-align: center;
    font-size: 10px;
    line-height: 1.15;
    color: var(--fg);
    background: var(--panel);
    border: 1px solid var(--border);
  }
  .middle.hot {
    border-color: var(--accent);
  }
  .middle span {
    max-width: 56px;
    overflow: hidden;
  }
  .item {
    position: absolute;
    width: 46px;
    height: 46px;
    margin: -23px 0 0 -23px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 19px;
    /* (its glyphs as text, in its colours: not a coloured emoji) */
    font-variant-emoji: text;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    transition: transform 90ms ease, background-color 90ms ease;
  }
  .item.on {
    color: var(--accent);
    border-color: var(--accent);
  }
  .item.hot {
    transform: scale(1.14);
    background: var(--sel-bg);
    border-color: var(--accent);
    color: var(--accent);
  }
  .item.off {
    opacity: 0.35;
  }
  .dot {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: 0 0 0 2px var(--bg), 0 0 0 3px var(--border);
  }
</style>
