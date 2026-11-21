<script lang="ts">
  const sections: [string, [string, string][]][] = [
    ['normal', [
      ['h j k l', 'move (j/k by visual line)'], ['w b', 'word'], ['0 $ gg G', 'line / doc ends'],
      ['i a I A o O', 'insert'], ['⏎ / c', 'edit math under cursor'], ['x D dd dw J', 'delete / join'],
      ['u  C-r', 'undo / redo'], ['\\  :', 'command palette'], ['f', 'draw arrow'], ['ga', 'select arrow'],
    ]],
    ['insert', [
      ['$', 'inline math ($$ for display)'], ['\\', 'command palette (\\\\ literal)'],
      ['# ## - ␣', 'markdown block shortcuts'], ['esc', 'normal mode'],
    ]],
    ['math', [
      ['/', 'fraction from previous operand'], ['^ _', 'super / subscript'], ['( [ {', 'auto-sized delimiters'],
      ['"', 'text'], [';a ;b ;G …', 'greek'], ['sum int lim', 'auto big operators'],
      ['-> => <= oo xx', 'auto symbols'], ['\\name', 'any command (falls back to raw LaTeX)'],
      ['space / tab', 'leave structure / next slot'], ['& ⏎', 'matrix: next column / row'], ['$  esc', 'exit to text / normal'],
    ]],
    ['arrow', [
      ['h l  j k', 'move target'], ['K J', 'zoom out / into structure'], ['H L', 'extend selection'],
      ['f', 'jump labels'], ['⏎', 'confirm endpoint'],
      ['j k =', 'style: bend / straighten'], ['r t d b', 'reverse, heads, dashed, box'], ['i x', 'label, delete'],
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
  <div class="foot">press ? or esc to close</div>
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
    max-width: min(880px, 92vw);
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
  kbd { min-width: 110px; color: var(--accent); font-family: inherit; }
  span { color: var(--fg); }
  .foot { margin-top: 14px; color: var(--muted); }
</style>
