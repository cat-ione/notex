// Notes kept in the browser (the web version has no folder of files): every note, saved as
// you type, in IndexedDB. A note can also be tied to a file on disk (see files.ts), whose
// handle is kept with it so it goes on saving there.

import type { Doc } from './model';
import { deserialize, serialize, type FileParts } from './format';

export type NoteMeta = {
  id: string;
  /** What it's called: given by the user, or a file's name. 'untitled' shows its title. */
  name: string;
  /** Its first line, to tell untitled notes apart. */
  title: string;
  /** Last saved (ms since 1970). */
  updated: number;
  /** The name of the file it's tied to, if any. */
  file?: string;
};
type Row = NoteMeta & { doc: string; handle?: FileSystemFileHandle };

const STORE = 'notes';
let opened: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  return (opened ??= new Promise((ok, fail) => {
    const r = indexedDB.open('notex', 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => {
      opened = null;
      fail(r.error);
    };
  }));
}

const done = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, fail) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });

async function store(mode: IDBTransactionMode) {
  return (await db()).transaction(STORE, mode).objectStore(STORE);
}

/** The text of a note's first line with words in it, without its markdown. */
export function titleOf(doc: Doc): string {
  for (const b of doc.blocks) {
    const s = b.items
      .map((i) => (i.t === 'c' ? i.ch : ' … '))
      .join('')
      .replace(/^#{1,3}\s+/, '')
      .replace(/^```.*/, '')
      .replace(/[*`]/g, '')
      .trim();
    if (s.replace(/…/g, '').trim()) return s.length > 60 ? s.slice(0, 59) + '…' : s;
  }
  return '';
}

/** How a note is listed: its name, or for an untitled one its first line. */
export const shownName = (n: Pick<NoteMeta, 'name' | 'title'>) => (n.name === 'untitled' && n.title ? n.title : n.name);

/** Every note, most recently saved first. */
export async function listNotes(): Promise<NoteMeta[]> {
  const rows = (await done((await store('readonly')).getAll())) as Row[];
  return rows.map(({ doc: _, handle: __, ...meta }) => meta).sort((a, b) => b.updated - a.updated);
}

export async function loadNote(id: string): Promise<(NoteMeta & { doc: Doc; handle: FileSystemFileHandle | null }) | null> {
  const r = (await done((await store('readonly')).get(id))) as Row | undefined;
  if (!r) return null;
  const { doc, handle, ...meta } = r;
  return { ...meta, doc: deserialize(doc), handle: handle ?? null };
}

/** Save a note (all of it: its file's handle too, or none). */
/** (`parts`: see FileParts; for a snapshot of the editor's) */
export async function saveNote(n: { id: string; name: string; doc: Doc; handle: FileSystemFileHandle | null }, parts?: FileParts) {
  const row: Row = { id: n.id, name: n.name, title: titleOf(n.doc), updated: Date.now(), doc: serialize(n.doc, parts) };
  if (n.handle) (row.handle = n.handle), (row.file = n.handle.name);
  await done((await store('readwrite')).put(row));
}

export async function renameNote(id: string, name: string) {
  const s = await store('readwrite');
  const r = (await done(s.get(id))) as Row | undefined;
  if (r) await done(s.put({ ...r, name }));
}

export async function deleteNote(id: string) {
  await done((await store('readwrite')).delete(id));
}

/** The note already tied to this file, if one is. */
export async function noteForFile(h: FileSystemFileHandle): Promise<string | null> {
  const rows = (await done((await store('readonly')).getAll())) as Row[];
  for (const r of rows) if (r.handle && (await r.handle.isSameEntry(h))) return r.id;
  return null;
}

/**
 * The notes with `q` in their text (not only their name), each with the line it's in, cut
 * down round it: what the notes list shows under a note found by what it says.
 */
export async function searchNotes(q: string): Promise<Map<string, string>> {
  const want = q.trim().toLowerCase();
  const out = new Map<string, string>();
  if (want.length < 2) return out;
  const rows = (await done((await store('readonly')).getAll())) as Row[];
  for (const r of rows) {
    // (a quick look at the stored text first: most notes don't have it)
    if (!r.doc.toLowerCase().includes(want)) continue;
    try {
      const file = JSON.parse(r.doc) as { blocks?: { content?: unknown[] }[] };
      for (const b of file.blocks ?? []) {
        const line = (b.content ?? []).map((c) => (typeof c === 'string' ? c : c && typeof c === 'object' && 's' in c ? String((c as { s: string }).s) : ' … ')).join('');
        const at = line.toLowerCase().indexOf(want);
        if (at < 0) continue;
        const from = Math.max(0, at - 24), to = Math.min(line.length, at + want.length + 40);
        out.set(r.id, (from ? '…' : '') + line.slice(from, to).trim() + (to < line.length ? '…' : ''));
        break;
      }
    } catch {}
  }
  return out;
}

// ── keeping notes safe: the browser may clear them, so they can be kept for good and backed up ──

/**
 * Ask the browser to keep the notes for good (not cleared when the disk runs low). It decides
 * by itself, without asking (granted for an installed app, or a site used often). Whether
 * they are now kept for good.
 */
export async function keepForGood(): Promise<boolean> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!s?.persist) return false;
  try {
    return (await s.persisted()) || (await s.persist());
  } catch {
    return false;
  }
}

/** Whether the browser keeps the notes for good (null: it can't say). */
export async function keptForGood(): Promise<boolean | null> {
  try {
    return (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    return null;
  }
}

/** A name as a file's: no characters a file name can't have, and not too long. */
export const fileName = (s: string) => s.replace(/[\/:*?"<>|\x00-\x1f]+/g, '-').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 80) || 'untitled';

/** Every note as a file, for a backup: named as the list shows it, no two the same. */
export async function backupFiles(): Promise<{ name: string; text: string }[]> {
  const rows = ((await done((await store('readonly')).getAll())) as Row[]).sort((a, b) => b.updated - a.updated);
  const taken = new Set<string>();
  return rows.map((r) => {
    const base = fileName(shownName(r));
    let name = `${base}.ntx`;
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${base} (${k}).ntx`;
    taken.add(name.toLowerCase());
    return { name, text: r.doc };
  });
}

/**
 * Notes from a backup (or any note files), each kept as a new note. One already here (the
 * same name and the very same file) is left out, so restoring a backup twice adds nothing.
 * `read`: a file's text as a note (markdown read as markdown); one it can't read is skipped.
 */
export async function restoreFiles(files: { name: string; text: string }[], read: (name: string, text: string) => Doc): Promise<{ added: number; same: number; bad: string[] }> {
  const rows = (await done((await store('readonly')).getAll())) as Row[];
  // (named as a backup names them: an untitled note by its first line)
  const have = new Set(rows.map((r) => `${fileName(shownName(r))}\n${r.doc}`));
  const out = { added: 0, same: 0, bad: [] as string[] };
  const now = Date.now();
  for (const [i, f] of files.entries()) {
    let doc: Doc;
    try {
      doc = read(f.name, f.text);
    } catch {
      out.bad.push(f.name);
      continue;
    }
    const name = f.name.replace(/^.*[\\/]/, '').replace(/\.(ntx|md|markdown)$/i, '').replace(/ \(\d+\)$/, '');
    // (a note file is kept as it is, so a second restore finds it the same)
    const text = /\.ntx$/i.test(f.name) ? f.text : serialize(doc);
    if (have.has(`${name}\n${text}`)) {
      out.same++;
      continue;
    }
    // (named by its first line, it was untitled; the backup's order kept: its first file the latest)
    const title = titleOf(doc);
    const row: Row = { id: crypto.randomUUID(), name: title && name === fileName(title) ? 'untitled' : name, title, updated: now - i, doc: text };
    await done((await store('readwrite')).put(row));
    have.add(`${name}\n${text}`);
    out.added++;
  }
  return out;
}
