// Note files. In the desktop app these go through native dialogs and Rust
// commands; in a plain browser we fall back to download / file-picker.

import type { Doc } from './model';
import { deserialize, serialize } from './format';

export const EXT = 'ntx';
const FILTERS = [{ name: 'notex note', extensions: [EXT] }];

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const baseName = (path: string) => path.split(/[\\/]/).pop()!.replace(new RegExp(`\\.${EXT}$`), '');

async function core() {
  return await import('@tauri-apps/api/core');
}
async function dialog() {
  return await import('@tauri-apps/plugin-dialog');
}

/** Ask for a file to open. Returns null when cancelled. */
export async function openNote(): Promise<{ path: string | null; name: string; doc: Doc } | null> {
  if (isDesktop()) {
    const path = await (await dialog()).open({ multiple: false, directory: false, filters: FILTERS });
    if (typeof path !== 'string') return null;
    return { path, name: baseName(path), doc: await readNote(path) };
  }
  const file = await pickBrowserFile();
  if (!file) return null;
  return { path: null, name: baseName(file.name), doc: deserialize(await file.text()) };
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

export async function writeNote(path: string, doc: Doc) {
  const { invoke } = await core();
  await invoke('write_note', { path, contents: serialize(doc) });
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
    return (await pickers().showOpenFilePicker(PICK))[0] ?? null;
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return null;
    throw e;
  }
}

export async function writeFile(h: FileSystemFileHandle, doc: Doc) {
  const w = await h.createWritable();
  await w.write(serialize(doc));
  await w.close();
}

export async function readFile(h: FileSystemFileHandle): Promise<Doc> {
  return deserialize(await (await h.getFile()).text());
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
export function downloadNote(name: string, doc: Doc) {
  const url = URL.createObjectURL(new Blob([serialize(doc)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.${EXT}` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickBrowserFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: `.${EXT},application/json` });
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
