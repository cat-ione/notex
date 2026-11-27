// Note files. In the desktop app these go through native dialogs and Rust
// commands; in a plain browser we fall back to download / file-picker.

import type { Doc } from './model';
import { deserialize, serialize, type FileParts } from './format';
import { markdownToDoc } from './mdfile';

export const EXT = 'ntx';
const FILTERS = [{ name: 'notex note', extensions: [EXT] }];
/** Opening: a note, or a markdown file (read in as a note; saved as a note, not over it). */
const OPEN_FILTERS = [{ name: 'notex note or markdown', extensions: [EXT, 'md', 'markdown'] }, ...FILTERS, { name: 'markdown', extensions: ['md', 'markdown'] }];
export const isMarkdown = (name: string) => /\.(md|markdown)$/i.test(name);
/** A file's text as a note: markdown read as markdown, else a note file. */
export const readDoc = (name: string, text: string): Doc => (isMarkdown(name) ? markdownToDoc(text) : deserialize(text));

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const baseName = (path: string) => path.split(/[\\/]/).pop()!.replace(new RegExp(`\\.(${EXT}|md|markdown)$`, 'i'), '');

async function core() {
  return await import('@tauri-apps/api/core');
}
async function dialog() {
  return await import('@tauri-apps/plugin-dialog');
}

/**
 * Ask for a file to open. Returns null when cancelled. A markdown file comes with no path:
 * it's read in as a note, and saving it asks where (a note isn't written over markdown).
 */
export async function openNote(): Promise<{ path: string | null; name: string; doc: Doc } | null> {
  if (isDesktop()) {
    const path = await (await dialog()).open({ multiple: false, directory: false, filters: OPEN_FILTERS });
    if (typeof path !== 'string') return null;
    if (isMarkdown(path)) {
      const { invoke } = await core();
      return { path: null, name: baseName(path), doc: markdownToDoc(await invoke<string>('read_note', { path })) };
    }
    return { path, name: baseName(path), doc: await readNote(path) };
  }
  const file = await pickBrowserFile();
  if (!file) return null;
  return { path: null, name: baseName(file.name), doc: readDoc(file.name, await file.text()) };
}

/** Save `text` as a markdown file named after the note (where the user says; the browser downloads it). */
export async function saveMarkdown(name: string, text: string): Promise<string | null> {
  const MD = [{ name: 'markdown', extensions: ['md'] }];
  if (isDesktop()) {
    let path = await (await dialog()).save({ defaultPath: `${name}.md`, filters: MD });
    if (!path) return null;
    if (!isMarkdown(path)) path += '.md';
    const { invoke } = await core();
    await invoke('write_note', { path, contents: text });
    return path;
  }
  if (canUseFiles()) {
    let h: FileSystemFileHandle;
    try {
      h = await pickers().showSaveFilePicker({ types: [{ description: 'markdown', accept: { 'text/markdown': ['.md'] } }], suggestedName: `${name}.md` });
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      throw e;
    }
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
    return h.name;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.md` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return `${name}.md`;
}

export async function readNote(path: string): Promise<Doc> {
  const { invoke } = await core();
  return deserialize(await invoke<string>('read_note', { path }));
}

/** Ask where to save. Returns the chosen path (desktop) or null if cancelled / browser. */
export async function chooseSavePath(suggested: string): Promise<string | null> {
  if (!isDesktop()) return null;
  const path = await (await dialog()).save({ defaultPath: `${suggested}.${EXT}`, filters: FILTERS });
  if (!path) return null;
  return path.toLowerCase().endsWith(`.${EXT}`) ? path : `${path}.${EXT}`;
}

/** (`parts`: see FileParts; for a snapshot of the editor's) */
export async function writeNote(path: string, doc: Doc, parts?: FileParts) {
  const { invoke } = await core();
  await invoke('write_note', { path, contents: serialize(doc, parts) });
}

/** The Windows app writes PDFs itself; elsewhere a PDF comes from the print dialog. */
export const canSavePdf = () => isDesktop() && navigator.userAgent.includes('Windows');

/** Ask where to save a PDF, next to the note (a path) or named after it. Null if cancelled. */
export async function choosePdfPath(note: string): Promise<string | null> {
  const defaultPath = note.replace(new RegExp(`\\.${EXT}$`, 'i'), '') + '.pdf';
  const path = await (await dialog()).save({ defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!path) return null;
  return path.toLowerCase().endsWith('.pdf') ? path : `${path}.pdf`;
}

/** Write a file's bytes (the desktop app). */
export async function writeBytes(path: string, b: Blob) {
  const { invoke } = await core();
  await invoke('write_bytes', { path, contents: Array.from(new Uint8Array(await b.arrayBuffer())) });
}

/** Write the page as it would print to a PDF file (sizes in inches). */
export async function savePdf(path: string, paper: { w: number; h: number }, margin: number) {
  const { invoke } = await core();
  await invoke('save_pdf', { path, width: paper.w, height: paper.h, margin });
}

// ── files in the browser (Chrome, Edge): picked once, then saved to as you type ──

type Picker = { types: { description: string; accept: Record<string, string[]> }[]; suggestedName?: string };
type FilePickers = {
  showSaveFilePicker(o: Picker): Promise<FileSystemFileHandle>;
  showOpenFilePicker(o: Picker): Promise<FileSystemFileHandle[]>;
};
type Permissions = {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
};
const pickers = () => window as unknown as FilePickers;
const PICK: Picker = { types: [{ description: 'notex note', accept: { 'application/json': [`.${EXT}`] } }] };
/** Opening: notes and markdown files. */
const PICK_OPEN: Picker = { types: [{ description: 'notex note or markdown', accept: { 'application/json': [`.${EXT}`], 'text/markdown': ['.md', '.markdown'] } }] };

/** Whether this browser can save to files on disk (else notes download). */
export const canUseFiles = () => !isDesktop() && typeof window !== 'undefined' && 'showSaveFilePicker' in window;

/** A file chosen to save to, or null if cancelled. */
export async function pickSaveFile(name: string): Promise<FileSystemFileHandle | null> {
  try {
    return await pickers().showSaveFilePicker({ ...PICK, suggestedName: `${name}.${EXT}` });
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return null;
    throw e;
  }
}

/** A note file chosen to open, or null if cancelled. */
export async function pickOpenFile(): Promise<FileSystemFileHandle | null> {
  try {
    return (await pickers().showOpenFilePicker(PICK_OPEN))[0] ?? null;
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return null;
    throw e;
  }
}

export async function writeFile(h: FileSystemFileHandle, doc: Doc, parts?: FileParts) {
  const w = await h.createWritable();
  await w.write(serialize(doc, parts));
  await w.close();
}

export async function readFile(h: FileSystemFileHandle): Promise<Doc> {
  return readDoc(h.name, await (await h.getFile()).text());
}

/**
 * Whether we may write to the file. After a reload the browser asks again; `ask` asks the
 * user then (only from a key press or click), otherwise it's just a question.
 */
export async function mayWrite(h: FileSystemFileHandle, ask: boolean): Promise<boolean> {
  const p = h as unknown as Permissions;
  if ((await p.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return ask && (await p.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Browser fallback (no file pickers): download the note. */
/**
 * Where a file made in the browser goes: a file picked now (before it's made, as picking
 * needs the click that asked for it), or else a download. Null if the picking was cancelled.
 */
export async function browserSaveTarget(name: string, ext: string, description: string, mime: string): Promise<((b: Blob) => Promise<string>) | null> {
  if (canUseFiles()) {
    let h: FileSystemFileHandle;
    try {
      h = await pickers().showSaveFilePicker({ types: [{ description, accept: { [mime]: [`.${ext}`] } }], suggestedName: `${name}.${ext}` });
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      throw e;
    }
    return async (b) => {
      const w = await h.createWritable();
      await w.write(b);
      await w.close();
      return h.name;
    };
  }
  return async (b) => {
    const url = URL.createObjectURL(b);
    Object.assign(document.createElement('a'), { href: url, download: `${name}.${ext}` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return `${name}.${ext}`;
  };
}

export function downloadNote(name: string, doc: Doc) {
  const url = URL.createObjectURL(new Blob([serialize(doc)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.${EXT}` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickBrowserFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: `.${EXT},application/json,.md,.markdown,text/markdown` });
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (!isDesktop()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTitle(title);
  } catch {}
}

/** Open a web address: in the system's browser (desktop), else in a new tab. */
export async function openUrl(url: string) {
  if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) url = 'https://' + url;
  if (isDesktop()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      return await openUrl(url);
    } catch {}
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** A note file next to another (desktop): its path. */
export const siblingPath = (path: string, name: string) => path.replace(/[^\\/]*$/, '') + name + '.' + EXT;
