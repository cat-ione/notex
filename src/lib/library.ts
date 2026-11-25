// Notes kept in the browser (the web version has no folder of files): every note, saved as
// you type, in IndexedDB. A note can also be tied to a file on disk (see files.ts), whose
// handle is kept with it so it goes on saving there.

import type { Doc } from './model';
import { deserialize, serialize } from './format';

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
export async function saveNote(n: { id: string; name: string; doc: Doc; handle: FileSystemFileHandle | null }) {
  const row: Row = { id: n.id, name: n.name, title: titleOf(n.doc), updated: Date.now(), doc: serialize(n.doc) };
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
