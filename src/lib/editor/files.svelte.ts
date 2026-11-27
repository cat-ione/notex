// The note's file: saving as you type (to its file, or among the notes kept in the browser),
// opening, saving as, and backing the browser's notes up. Part of the Editor (see
// editor.svelte.ts); the file itself is ed.file.

import * as F from '../files';
import * as L from '../library';
import { unzip, zip } from '../zip';
import { block, uid } from '../model';
import type { Editor } from '../editor.svelte';
import { STORAGE_KEY } from '../editor.svelte';

export class NoteFiles {
  constructor(private ed: Editor) {}

  /** Session backup (survives reloads/crashes) plus autosave to the note's file if it has one. */
  async persist() {
    // caret moves bump the version too: only write when something was edited
    if (this.ed.edits === this.ed.persistedEdits && !(this.ed.file.path && this.ed.dirty)) return;
    this.ed.persistedEdits = this.ed.edits;
    try {
      localStorage.setItem(STORAGE_KEY, this.ed.docJSON(this.ed.snapshot()));
      localStorage.setItem('notex.file', JSON.stringify({ ...this.ed.file, dirty: this.ed.dirty }));
    } catch {}
    if (this.ed.file.path && this.ed.dirty) await this.writeTo(this.ed.file.path, true);
    // (only edits: opening a note doesn't make it the latest)
    else if (!F.isDesktop() && this.ed.dirty) await this.keepInBrowser();
  }

  /** Browser: save the note among the notes kept here, and to its file if it has one. */
  async keepInBrowser() {
    const edits = this.ed.edits;
    const doc = this.ed.snapshot();
    const id = (this.ed.file.id ??= uid());
    try {
      await L.saveNote({ id, name: this.ed.file.name, doc, handle: this.ed.handle }, this.ed.fileParts);
      if (this.ed.handle && (await F.mayWrite(this.ed.handle, false))) await F.writeFile(this.ed.handle, doc, this.ed.fileParts);
      if (edits === this.ed.edits) this.ed.dirty = false;
      localStorage.setItem('notex.file', JSON.stringify({ ...this.ed.file, dirty: this.ed.dirty }));
      // (once there's a note to lose: asked once a visit, the browser answers by itself)
      if (!this.askedToKeep) (this.askedToKeep = true), void L.keepForGood();
    } catch (e) {
      this.ed.flash(`couldn't save: ${e}`);
    }
  }
  private askedToKeep = false;

  /** Browser: every note kept here saved to one zip file (of .ntx files), where the user says. */
  async backupNotes() {
    await this.persist();
    const day = new Date().toISOString().slice(0, 10);
    try {
      const files = await L.backupFiles();
      if (!files.length) return this.ed.flash('no notes to back up yet');
      const save = await F.browserSaveTarget(`notex notes ${day}`, 'zip', 'notes backup', 'application/zip');
      if (!save) return;
      const enc = new TextEncoder();
      const name = await save(new Blob([zip(files.map((f) => ({ name: f.name, data: enc.encode(f.text) }))) as BlobPart], { type: 'application/zip' }));
      try {
        localStorage.setItem('notex.backup', String(Date.now()));
      } catch {}
      this.ed.flash(`backed up ${files.length} note${files.length === 1 ? '' : 's'} to ${name}`);
    } catch (e) {
      this.ed.flash(`couldn't back up: ${e}`);
    }
  }

  /** Browser: notes from a backup (a zip), or note and markdown files, kept here as new notes. */
  async restoreNotes() {
    const picked = await F.pickBrowserFiles('.zip,application/zip,.ntx,.md,.markdown');
    if (!picked.length) return;
    await this.persist();
    try {
      const files: { name: string; text: string }[] = [];
      const dec = new TextDecoder();
      for (const f of picked) {
        if (/\.zip$/i.test(f.name)) {
          for (const e of await unzip(new Uint8Array(await f.arrayBuffer())))
            if (/\.(ntx|md|markdown)$/i.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name)) files.push({ name: e.name, text: dec.decode(e.data) });
        } else files.push({ name: f.name, text: await f.text() });
      }
      if (!files.length) return this.ed.flash('no notes in that file');
      const r = await L.restoreFiles(files, F.readDoc);
      const said = [`${r.added} note${r.added === 1 ? '' : 's'} restored`];
      if (r.same) said.push(`${r.same} already here`);
      if (r.bad.length) said.push(`couldn't read ${r.bad.join(', ')}`);
      this.ed.flash(said.join(', '));
      this.notesChanged++;
    } catch (e) {
      this.ed.flash(`couldn't restore: ${e}`);
    }
  }
  /** Bumped when notes are added to those kept here by other means than typing (the list shows them). */
  notesChanged = $state(0);

  /**
   * Browser: pick up where the last visit left off (the open note's file, to go on saving
   * to it) and keep a note from before notes were kept here.
   */
  async initLibrary() {
    if (F.isDesktop()) return;
    try {
      const row = this.ed.file.id ? await L.loadNote(this.ed.file.id) : null;
      if (row) this.ed.handle = row.handle;
      else if (this.ed.file.name !== 'welcome' || this.ed.dirty) await this.keepInBrowser();
    } catch {}
  }

  /** Browser: open one of the notes kept here. */
  async openKept(id: string) {
    if (id === this.ed.file.id) return void (this.ed.showNotes = false);
    await this.persist();
    const row = await L.loadNote(id);
    if (!row) return this.ed.flash('that note is gone');
    this.ed.load(row.doc, { path: null, name: row.name, id }, row.handle);
    this.ed.showNotes = false;
  }

  /** Browser: open a note file from disk (kept here from then on, and saved back to it). */
  async openFromDisk() {
    await this.persist();
    try {
      if (F.canUseFiles()) {
        const h = await F.pickOpenFile();
        if (!h) return;
        const known = await L.noteForFile(h);
        if (known) return this.openKept(known);
        // (a markdown or LaTeX file is read in, not saved back to: a note isn't written over it)
        this.ed.load(await F.readFile(h), { path: null, name: F.baseName(h.name), id: uid() }, F.isForeign(h.name) ? null : h);
      } else {
        const r = await F.openNote();
        if (!r) return;
        this.ed.load(r.doc, { path: null, name: r.name, id: uid() });
      }
      this.ed.showNotes = false;
      await this.keepInBrowser();
    } catch (e) {
      this.ed.flash(`couldn't open: ${e}`);
    }
  }

  /** Browser: rename a kept note (the open one too). */
  async renameKept(id: string, name: string) {
    name = name.trim() || 'untitled';
    if (id === this.ed.file.id) {
      this.ed.file.name = name;
      await this.keepInBrowser();
    } else await L.renameNote(id, name);
  }

  /** Browser: delete a kept note; deleting the open one opens the next (or a new one). */
  async deleteKept(id: string) {
    await L.deleteNote(id);
    if (id !== this.ed.file.id) return;
    const next = (await L.listNotes())[0];
    const row = next ? await L.loadNote(next.id) : null;
    if (row) this.ed.load(row.doc, { path: null, name: row.name, id: row.id }, row.handle);
    else this.ed.load({ blocks: [block()], arrows: [], marks: [] }, { path: null, name: 'untitled', id: uid() });
    try {
      localStorage.setItem('notex.file', JSON.stringify({ ...this.ed.file, dirty: false }));
      localStorage.setItem(STORAGE_KEY, this.ed.docJSON(this.ed.snapshot()));
    } catch {}
  }

  /** Where the note is saved, for the status bar. */
  get savedWhere(): string {
    if (this.ed.file.path) return this.ed.file.path;
    if (F.isDesktop()) return 'not saved';
    return this.ed.handle ? `in this browser and in ${this.ed.handle.name}` : 'in this browser';
  }

  private async writeTo(path: string, quiet = false) {
    const edits = this.ed.edits;
    try {
      await F.writeNote(path, this.ed.snapshot(), this.ed.fileParts);
      if (edits === this.ed.edits) this.ed.dirty = false;
      if (!quiet) this.ed.flash(`saved ${F.baseName(path)}`);
      return true;
    } catch (e) {
      this.ed.flash(String(e));
      return false;
    }
  }

  async saveNote() {
    if (this.ed.file.path) return this.writeTo(this.ed.file.path);
    if (!F.isDesktop() && this.ed.handle && (await F.mayWrite(this.ed.handle, true))) return this.saveToDisk(this.ed.handle);
    return this.saveNoteAs();
  }

  /** Browser: write the note to its file (and keep it here too). */
  private async saveToDisk(h: FileSystemFileHandle) {
    try {
      await F.writeFile(h, this.ed.snapshot());
      this.ed.handle = h;
      await this.keepInBrowser();
      this.ed.flash(`saved ${h.name}`);
      return true;
    } catch (e) {
      this.ed.flash(`couldn't save: ${e}`);
      return false;
    }
  }

  async saveNoteAs() {
    if (!F.isDesktop()) {
      if (F.canUseFiles()) {
        const h = await F.pickSaveFile(this.ed.file.name);
        if (!h) return false;
        this.ed.file.name = F.baseName(h.name);
        return this.saveToDisk(h);
      }
      F.downloadNote(this.ed.file.name, this.ed.snapshot());
      return true;
    }
    const path = await F.chooseSavePath(this.ed.file.name);
    if (!path) return false;
    if (!(await this.writeTo(path))) return false;
    this.ed.file = { path, name: F.baseName(path) };
    return true;
  }

  /** Untitled notes with changes would be lost; ask before replacing them. */
  async okToReplace(): Promise<boolean> {
    // (in the browser every note is kept: save this one and go)
    if (!F.isDesktop()) return await this.persist(), true;
    if (!this.ed.dirty || this.ed.file.path) return true;
    const msg = `"${this.ed.file.name}" has unsaved changes. Discard them?`;
    if (F.isDesktop()) {
      const { ask } = await import('@tauri-apps/plugin-dialog');
      return ask(msg, { title: 'notex', kind: 'warning', okLabel: 'Discard', cancelLabel: 'Keep' });
    }
    return confirm(msg);
  }

  async openNote() {
    // (in the browser: the notes kept here, and files from there)
    if (!F.isDesktop()) return void (this.ed.showNotes = true);
    if (!(await this.okToReplace())) return;
    try {
      const r = await F.openNote();
      if (r) this.ed.load(r.doc, { path: r.path, name: r.name });
    } catch (e) {
      this.ed.flash(`couldn't open: ${e}`);
    }
  }

  async newNote() {
    if (!(await this.okToReplace())) return;
    this.ed.load({ blocks: [block()], arrows: [], marks: [] }, { path: null, name: 'untitled', ...(F.isDesktop() ? {} : { id: uid() }) });
  }
}
