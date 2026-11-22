<script lang="ts">
  const sections: [string, [string, string][]][] = [
    ['writing', [
      ['$', 'start math ($$ for a centered block)'], ['\\  or  ctrl+k', 'commands'],
      ['# ␣   ## ␣   - ␣', 'heading, subheading, list'], ['1. ␣   tab  shift+tab', 'numbered list, nest / un-nest'],
      ['ctrl+b  ctrl+i', 'bold, italic (or **word**, *word*)'], ['x^2  a_n', 'in text: becomes math'],
      ['ctrl+f  F3', 'find, next match'], ['alt+↑ ↓', 'move the paragraph (or the selected ones)'], ['ctrl+s  o  n', 'save, open, new note'], ['ctrl+,', 'settings, substitutions, themes'], ['F1', 'this help'],
    ]],
    ['math', [
      ['/', 'fraction from what you just typed'], ['^  _', 'one thing up / down: x^2, x^10, e^-x'], ['^(…)  _(…)', 'more than one: e^(-x^2/2), \\int_0^(2\\pi)'],
      ['( [ {', 'brackets that grow'], ['"', 'words inside math'], ['\\alpha  ;a', 'greek letters'],
      ['\\name', 'any LaTeX command: \\sqrt, \\in, \\sin, \\int_0^1'], ['-> => <= != +-', 'arrows, ≤, ≠, ±'],
      ['ctrl+,  substitutions', 'shortcuts like alpha → α, and your own'], ['space / tab', 'leave box / next box'],
      ['ctrl+← →', 'by whole pieces (shift: select)'], ['& enter', 'matrix: new column / row'], ['shift+← → / ctrl+a', 'select (grows out of boxes)'], ['/  (  \\cmd', 'wrap the selection'], ['$  →  esc', 'back to text'],
    ]],
    ['drawing  (\\arrow  \\circle  \\box …)', [
      ['ctrl+d', 'draw menu, in text or inside math'],
      ['select, then \\cmd', 'draw on the selection right away'],
      ['← → ↑ ↓  or click', 'choose a word or symbol'], ['shift+↑ / shift+↓', 'whole expression / inside it'],
      ['shift+← →', 'extend over neighbours'], ['home  end', 'first / last on the line'], ['tab', 'jump labels'], ['enter', 'confirm start, then end'],
      ['alt+drag', 'arrow from one thing to another'], ['alt+shift+drag', 'shape around a range (the last kind)'],
    ]],
    ['changing a drawing  (click it, or \\drawings)', [
      ['drag the dots', 'move an arrow\'s ends, or its middle anywhere'], ['↑ ↓  ← →', 'move an arrow\'s middle across / along it'], ['0', 'straight'], ['t', 'arrowheads / next shape'], ['d', 'dashed'], ['b', 'box the ends'],
      ['c', 'colour'], ['l', 'note'], ['s  e', 'move the start / tip (shape: e)'], ['shift+s  shift+e', 'where the start / tip attaches'], ['r', 'reverse'], ['del', 'remove'],
      ['shift+← →', 'shape: move its end (ctrl+shift: its start)'], ['alt+arrows', 'move the note (shift: by a pixel)'], ['alt+0', 'put the note back'],
      ['shift+f10', 'menu of all of these'], ['\\', 'search them by name'],
    ]],
    ['mouse', [
      ['click / right-click', 'select a drawing or note / its menu'], ['right-click the page', 'copy, paste, draw on the selection, undo'], ['double-click', 'type its note, caret where you clicked'],
      ['drag a shape', 'move it onto another word or symbol'], ['drag an arrow', 'bend it through the mouse'], ['drag an end dot', 'onto a side of the target: attach there'],
      ['wheel near it', 'next shape / bend (shift: colour)'], ['middle-click', 'remove it'],
      ['drag a note', 'move it (alt+0 puts it back)'], ["drag a shape's ends", 'cover more or less'],
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
