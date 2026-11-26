<script lang="ts">
  import type { Editor } from '$lib/editor.svelte';

  let { ed }: { ed: Editor } = $props();

  const sections: [string, [string, string][]][] = [
    ['writing', [
      ['$', 'inline math ($$ for display math)'], ['\\  or  ctrl+k', 'command palette'],
      ['# ␣   ## ␣   - ␣', 'heading, subheading, bullet list'], ['1. ␣   tab  shift+tab', 'numbered list, indent / outdent'],
      ['ctrl+b  ctrl+i', 'bold, italic (or **bold**, *italic*)'], ['ctrl+shift+x  h', 'struck, highlighted (or ~~struck~~, ==highlighted==)'], ['x^2  a_n', 'converted to math automatically'],
      ['`code`  ctrl+e', 'inline code'], ['```py  enter', 'code block (closed for you; markdown shows where the caret is)'],
      ['\\table   | a | b |', 'table: tab next cell, enter new row'],
      ['paste / drop / \\image', 'insert an image (type under it for a caption)'], ['alt+← →', 'image: resize (or drag its corner)'],
      ['ctrl+f  F3  ctrl+h', 'find, find next, find and replace'], ['ctrl+= ctrl+- ctrl+0', 'zoom (or ctrl+wheel, a pinch)'], ['alt+↑ ↓', 'move paragraph up / down'], ['ctrl+s  o  n', 'save, open, new'], ['\\pdf  ctrl+p', 'save as PDF, print'], ['ctrl+,', 'settings'], ['\\toolbar  \\statusbar', 'show / hide the bars'], ['F1', 'keyboard shortcuts'],
    ]],
    ['structure', [
      ['[ ] ␣   [x] ␣', 'a box to tick (after - too); ctrl+enter ticks it'],
      ['\\theorem  \\definition  \\proof …', 'the line in a box, numbered (again: out of it); enter goes on in it, enter twice leaves'],
      ['> ␣', 'a quote'],
      ['\\number', 'number the display formula (1), (2)…'],
      ['\\ref', 'refer to a formula or a theorem: (3), Theorem 2 (numbers it if need be)'],
      ['[[a note]]  https://…', 'links: ctrl+click (a tap) opens them; [[a note]] makes it if there is none'],
      ['ctrl+.  \\foldall', 'fold the section under a heading (the ▾ in the margin too)'],
      ['ctrl+shift+o', 'the outline: headings and theorems; click to go there'],
      ['ctrl+o, then type', 'notes by name, or by what they say'],
      ['\\markdown  \\copymarkdown', 'save / copy as markdown (.md files open too)'],
    ]],
    ['math', [
      ['/', 'fraction'], ['^  _', 'superscript / subscript: x^2, x^10, e^-x'], ['^(…)  _(…)', 'longer scripts: e^(-x^2/2), \\int_0^(2\\pi)'],
      ['( [ {', 'brackets'], ['"', 'text inside math'], ['\\alpha  ;a', 'greek letters'],
      ['\\name', 'LaTeX command: \\sqrt, \\in, \\sin, \\int_0^1'],
      ['\\int  \\sum  \\lim', 'with empty limits: space goes from the lower to the upper one, then on (\\intop, \\sumop…: bare)'], ['-> => <= != +-', '→ ⇒ ≤ ≠ ±'],
      ['space / tab', 'exit box / next box'],
      ['ctrl+← →', 'move by word (shift: select)'], ['& enter', 'matrix: new column / row'], ['shift+← → / ctrl+a', 'select'], ['/  (  \\cmd', 'wrap the selection'], ['$  →  esc', 'exit math'],
    ]],
    ['drawing  (\\arrow  \\circle  \\box …)', [
      ['ctrl+d', 'draw menu'],
      ['select, then \\cmd', 'draw on the selection'],
      ['← → ↑ ↓  or click', 'choose a word or symbol'], ['shift+↑ / shift+↓', 'select parent / child expression'],
      ['shift+← →', 'extend selection'], ['home  end', 'first / last on the line'], ['tab', 'jump labels'], ['enter', 'confirm start, then end'],
      ['alt+drag', 'draw an arrow'], ['alt+shift+drag', 'draw a shape (last used kind)'],
    ]],
    ['editing a drawing  (click it, or \\drawings)', [
      ['drag handles', "move an arrow's ends or reshape it"], ['↑ ↓  ← →', 'bend / shift the curve'], ['0', 'straighten'], ['t', 'arrowheads / next shape'], ['d', 'dashed'], ['b', 'box endpoints'],
      ['c', 'colour'], ['l', 'note'], ['s  e', 'move start / end (shape: e)'], ['shift+s  shift+e', 'start / end anchor'], ['r', 'reverse'], ['del', 'delete'],
      ['shift+← →', 'resize shape (ctrl+shift: from the start)'], ['alt+arrows', 'move note (shift: by 1px)'], ['alt+0', 'reset note position'],
      ['shift+f10', 'all actions'], ['\\', 'search actions'],
    ]],
    ['mouse', [
      ['click / right-click', 'select / context menu'], ['right-click the page', 'copy, paste, draw, undo'], ['double-click', 'edit note'],
      ['drag a shape', 'move it'], ['drag an arrow', 'bend it'], ['drag an end handle', 'move it; drop on a side to anchor'],
      ['scroll over it', 'next shape / bend (shift: colour)'], ['middle-click', 'delete'],
      ['drag a note', 'move it (alt+0 resets)'], ["drag a shape's ends", 'resize'],
    ]],
    ['diagrams and the pen  (\\diagram  \\sketch)', [
      ['ctrl+shift+d', 'draw in the diagram at the caret, or on the note; again to stop'],
      ['v p h l a r o d t g e', 'select, pen, highlighter, line, arrow, box, ellipse, diamond, text, graph, eraser'],
      ['\\graph', 'a graph: type what to plot, y = sin x (shift+enter: another; x: -pi..pi, y: -1..1)'],
      ['hold the pen still', 'at the end of a rough line, box, circle or diamond: it straightens'],
      ['drag  /  tap', 'draw the shape  /  a box of the usual size (on the grid; alt: off it)'], ['enter', 'label the selected box or arrow, or a new box'],
      ['ctrl+← → ↑ ↓', 'a box beside this one, joined by an arrow (while typing a label too)'],
      ['arrow from box to box', 'stays attached when they move'], ['$…$ in a label', 'math'],
      ['c  w  -  f', 'colour, width, dashes, fill'], ['← → ↑ ↓', 'move (shift: by 10)'], ['tab', 'next shape'],
      ['ctrl+d  del', 'copy, delete'], [']  [', 'to the front / back'], ['ctrl+a', 'select all'], ['right-click', 'what can be done there'], ['esc', 'deselect, then back to the text'],
      ['pen', 'draws on the note any time (pressure: width; its eraser end erases); typing goes back'],
      ['finger', 'draws, until a pen has been used: then it scrolls, and a palm does nothing'],
      ['pen’s side button', 'drag: a lasso round what to select (on a shape: moves it); tap: the ring menu there'],
      ['finger held still, a long press', 'the ring menu: the tools, colours, undo; on a selection, what can be done to it'],
      ['two / three fingers tapped', 'undo / redo'],
      ['a tap on the text', '(finger or pen) the touch keyboard comes up, to type there'],
      ['⋯ beside a selection', '(with a pen or finger) what can be done to it'],
    ]],
  ];
</script>

<div class="help">
  <div class="title">keyboard shortcuts</div>
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
  <div class="foot">
    <button class="welcome" onclick={() => ed.openWelcome()}>open the welcome note</button>
    <span>{ed.input === 'mouse' ? 'click outside to close' : 'F1 or esc to close'}</span>
  </div>
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
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 32px; }
  h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
  .row { display: flex; gap: 12px; padding: 1px 0; }
  kbd { min-width: 150px; color: var(--accent); font-family: inherit; font-variant-ligatures: none; }
  span { color: var(--fg); }
  .foot { margin-top: 14px; color: var(--muted); display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .welcome {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 8px;
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .welcome:hover { border-color: var(--accent); color: var(--accent); }
</style>
