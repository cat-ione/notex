<script lang="ts">
  const sections: [string, [string, string][]][] = [
    ['writing', [
      ['$', 'start math ($$ for a centered block)'], ['\\  or  ctrl+k', 'commands'],
      ['# ␣   ## ␣   - ␣', 'heading, subheading, list'], ['click / shift+arrows', 'place caret / select'],
      ['ctrl+c  x  v', 'copy, cut, paste (math included)'], ['ctrl+z  ctrl+y', 'undo, redo'],
      ['ctrl+← →', 'jump by word'], ['F1', 'this help'],
    ]],
    ['math', [
      ['/', 'fraction from what you just typed'], ['^  _', 'superscript, subscript'],
      ['( [ {', 'brackets that grow'], ['"', 'words inside math'], ['alpha  ;a', 'greek letters'],
      ['sqrt sum int lim', 'roots and big operators'], ['-> => <= oo xx', 'arrows, ≤, ∞, ×'],
      ['\\name', 'any LaTeX command'], ['space / tab', 'leave box / next box'],
      ['& enter', 'matrix: new column / row'], ['$  →  esc', 'back to text'],
    ]],
    ['drawing arrows  (\\arrow)', [
      ['← → ↑ ↓  or click', 'choose a word or symbol'], ['shift+↑ / shift+↓', 'whole expression / inside it'],
      ['shift+← →', 'extend over neighbours'], ['tab', 'jump labels'], ['enter', 'confirm start, then end'],
    ]],
    ['styling arrows  (\\arrows to reselect)', [
      ['↑ ↓', 'bend'], ['0', 'straight'], ['t', 'arrowheads'], ['d', 'dashed'], ['b', 'box the ends'],
      ['l', 'label'], ['r', 'reverse'], ['del', 'remove'],
    ]],
  ];
</script>

<div class="help">
  <div class="title">notex <span>· keys</span></div>
  <div class="grid">
    {#each sections as [name, rows]}
      <section>
        <h3>{name}</h3>
        {#each rows as [k, d]}
          <div class="row"><kbd>{k}</kbd><span>{d}</span></div>
        {/each}
      </section>
    {/each}
  </div>
  <div class="foot">press F1 or esc to close</div>
</div>

<style>
  .help {
    font-family: var(--mono);
    font-size: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 18px 22px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    max-width: min(900px, 92vw);
    max-height: 86vh;
    overflow: auto;
    animation: pop 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  @keyframes pop {
    from { transform: scale(0.96) translateY(6px); opacity: 0; }
  }
  .title { font-size: 15px; font-weight: 700; color: var(--accent); margin-bottom: 12px; }
  .title span { color: var(--muted); font-weight: 400; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 32px; }
  h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
  .row { display: flex; gap: 12px; padding: 1px 0; }
  kbd { min-width: 150px; color: var(--accent); font-family: inherit; }
  span { color: var(--fg); }
  .foot { margin-top: 14px; color: var(--muted); }
</style>
