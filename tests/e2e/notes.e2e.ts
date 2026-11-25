// Notes kept in the browser: saved as you type, listed with ctrl+o, renamed, deleted, and
// tied to files on disk where the browser can (the file pickers are stood in for by the
// browser's private file storage, which hands out real file handles).
import { test, expect, open, fresh, type, text, ed, saved } from './helpers';
import type { Page } from '@playwright/test';

type Kept = { id: string; name: string; title: string; file?: string };

/** The notes kept in the browser's database, newest first. */
function kept(page: Page): Promise<Kept[]> {
  return page.evaluate(
    () =>
      new Promise<Kept[]>((ok, fail) => {
        const r = indexedDB.open('notex', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('notes', { keyPath: 'id' });
        r.onerror = () => fail(r.error);
        r.onsuccess = () => {
          const all = r.result.transaction('notes', 'readonly').objectStore('notes').getAll();
          all.onsuccess = () => {
            r.result.close();
            ok((all.result as any[]).sort((a, b) => b.updated - a.updated).map(({ id, name, title, file }) => ({ id, name, title, file })));
          };
        };
      }),
  );
}

/** File pickers that hand out files in the browser's private storage. */
async function fakePickers(page: Page) {
  await page.addInitScript(() => {
    const dir = () => navigator.storage.getDirectory();
    (window as any).showSaveFilePicker = async (o: { suggestedName: string }) => (await dir()).getFileHandle((window as any).__saveAs ?? o.suggestedName, { create: true });
    (window as any).showOpenFilePicker = async () => [await (await dir()).getFileHandle((window as any).__openName)];
  });
}

/** A file's text in the browser's private storage. */
function fileText(page: Page, name: string) {
  return page.evaluate(async (name) => {
    const h = await (await navigator.storage.getDirectory()).getFileHandle(name);
    return (await h.getFile()).text();
  }, name);
}

const panelRows = (page: Page) => page.locator('.panel .row .name');

test('the welcome note is kept only once it is edited', async ({ page }) => {
  await open(page);
  await page.waitForTimeout(800);
  expect(await kept(page)).toEqual([]);
  await page.keyboard.press('Control+End');
  await type(page, ' and more');
  await saved(page);
  const notes = await kept(page);
  expect(notes).toHaveLength(1);
  expect(notes[0].name).toBe('welcome');
});

test('a new note is kept as you type and comes back after a reload', async ({ page }) => {
  await open(page);
  await fresh(page);
  await type(page, 'Group theory, lecture 1');
  await saved(page);
  expect((await kept(page)).map((n) => n.title)).toEqual(['Group theory, lecture 1']);
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  expect(await text(page)).toBe('Group theory, lecture 1');
});

test('ctrl+o lists the notes; untitled ones by their first line', async ({ page }) => {
  await open(page);
  await fresh(page);
  await type(page, 'first note');
  await saved(page);
  await fresh(page);
  await type(page, 'second note');
  await saved(page);
  await page.keyboard.press('Control+o');
  await expect(page.locator('.panel')).toBeVisible();
  await expect(panelRows(page)).toHaveText(['second note', 'first note', '+ new note', 'open a file…']);
  // the latest other note is picked: enter goes back to it
  await expect(page.locator('.panel .row.sel .name')).toHaveText('first note');
});

test('opening another note from the list, by keys', async ({ page }) => {
  await open(page);
  await fresh(page);
  await type(page, 'alpha');
  await saved(page);
  await fresh(page);
  await type(page, 'beta');
  await saved(page);
  // ctrl+o, enter: back to the other note, and again
  await page.keyboard.press('Control+o');
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel')).toHaveCount(0);
  expect(await text(page)).toBe('alpha');
  await page.keyboard.press('Control+o');
  await page.keyboard.press('Enter');
  expect(await text(page)).toBe('beta');
  // or pick by arrows: down from the other note is the next one (here: + new note)
  await page.keyboard.press('Control+o');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.panel .row.sel .name')).toHaveText('beta');
  await page.keyboard.press('Enter');
  expect(await text(page)).toBe('beta');
});

test('typing in the list filters it', async ({ page }) => {
  await open(page);
  for (const t of ['linear algebra', 'real analysis', 'algebraic topology']) {
    await fresh(page);
    await type(page, t);
    await saved(page);
  }
  await page.keyboard.press('Control+o');
  await page.keyboard.type('algebra');
  await expect(panelRows(page)).toHaveText(['algebraic topology', 'linear algebra', '+ new note', 'open a file…']);
  await page.keyboard.press('Enter');
  expect(await text(page)).toBe('algebraic topology');
});

test('renaming a note with F2, kept after a reload', async ({ page }) => {
  await open(page);
  await fresh(page);
  await type(page, 'notes from monday');
  await saved(page);
  await page.keyboard.press('Control+o');
  await expect(page.locator('.panel .row.sel .name')).toHaveText('notes from monday');
  await page.keyboard.press('F2');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Monday');
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel .row.sel .name')).toHaveText('Monday');
  await page.keyboard.press('Escape');
  await expect(page.locator('.toolbar .note')).toContainText('Monday');
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  expect(await ed(page, (e) => e.file.name)).toBe('Monday');
  expect((await kept(page))[0].name).toBe('Monday');
});

test('deleting takes shift+del twice; deleting the open note opens the next', async ({ page }) => {
  await open(page);
  await fresh(page);
  await type(page, 'keep me');
  await saved(page);
  await fresh(page);
  await type(page, 'delete me');
  await saved(page);
  await page.keyboard.press('Control+o');
  await page.keyboard.press('ArrowUp'); // the open note
  await expect(page.locator('.panel .row.sel .name')).toHaveText('delete me');
  await page.keyboard.press('Shift+Delete');
  await expect(page.locator('.panel .warn')).toBeVisible();
  expect(await kept(page)).toHaveLength(2);
  await page.keyboard.press('Shift+Delete');
  await expect(panelRows(page)).toHaveText(['keep me', '+ new note', 'open a file…']);
  expect((await kept(page)).map((n) => n.title)).toEqual(['keep me']);
  expect(await text(page)).toBe('keep me');
});

test('escape cancels a pending delete', async ({ page }) => {
  await open(page);
  await fresh(page);
  await type(page, 'precious');
  await saved(page);
  await page.keyboard.press('Control+o');
  await page.keyboard.press('Shift+Delete');
  await page.keyboard.press('Escape');
  await expect(page.locator('.panel .warn')).toHaveCount(0);
  await expect(page.locator('.panel')).toBeVisible();
  expect(await kept(page)).toHaveLength(1);
});

test('+ new note in the list starts an empty note', async ({ page }) => {
  await open(page);
  await fresh(page);
  await type(page, 'old');
  await saved(page);
  await page.keyboard.press('Control+o');
  await page.locator('.panel .row', { hasText: '+ new note' }).click();
  await expect.poll(() => text(page)).toBe('');
  await type(page, 'new');
  await saved(page);
  expect((await kept(page)).map((n) => n.title)).toEqual(['new', 'old']);
});

test('a note from before notes were kept in the browser is kept', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const doc = { blocks: [{ id: 'b1', kind: 'p', items: [...'an old note'].map((ch, i) => ({ t: 'c', ch, id: 'c' + i })) }], arrows: [], marks: [] };
    localStorage.setItem('notex.doc.v1', JSON.stringify(doc));
    localStorage.setItem('notex.file', JSON.stringify({ path: null, name: 'untitled', dirty: true }));
  });
  await open(page);
  expect(await text(page)).toBe('an old note');
  await expect.poll(async () => (await kept(page)).map((n) => n.title)).toEqual(['an old note']);
});

test('ctrl+s saves to a file, then every edit saves there too', async ({ page }) => {
  await fakePickers(page);
  await open(page);
  await fresh(page);
  await type(page, 'to disk');
  await page.evaluate(() => ((window as any).__saveAs = 'lecture.ntx'));
  await page.keyboard.press('Control+s');
  await expect.poll(() => fileText(page, 'lecture.ntx').catch(() => '')).toContain('to disk');
  expect(await ed(page, (e) => e.file.name)).toBe('lecture');
  await type(page, ' and back');
  await saved(page);
  await expect.poll(() => fileText(page, 'lecture.ntx')).toContain('to disk and back');
  expect((await kept(page))[0].file).toBe('lecture.ntx');
  await expect(page.locator('.toolbar .note')).toHaveAttribute('data-tip', 'your notes · saved in this browser and in lecture.ntx');
  // after a reload it still saves to the file
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  await page.keyboard.press('Control+End');
  await type(page, '!');
  await saved(page);
  await expect.poll(() => fileText(page, 'lecture.ntx')).toContain('to disk and back!');
});

test('opening a file from the list keeps it, and opening it again finds the same note', async ({ page }) => {
  await fakePickers(page);
  await open(page);
  // a file on disk, written by an earlier save
  await fresh(page);
  await type(page, 'from a file');
  await page.evaluate(() => ((window as any).__saveAs = 'old.ntx'));
  await page.keyboard.press('Control+s');
  await expect.poll(() => fileText(page, 'old.ntx').catch(() => '')).toContain('from a file');
  await fresh(page);
  await type(page, 'something else');
  await saved(page);
  await page.evaluate(() => ((window as any).__openName = 'old.ntx'));
  await page.keyboard.press('Control+o');
  await page.locator('.panel .row', { hasText: 'open a file' }).click();
  await expect.poll(() => text(page)).toBe('from a file');
  expect(await kept(page)).toHaveLength(2);
  await expect(page.locator('.panel')).toHaveCount(0);
});

test('without file pickers, ctrl+s downloads the note', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as any).showSaveFilePicker;
    delete (window as any).showOpenFilePicker;
  });
  await open(page);
  await fresh(page);
  await type(page, 'download me');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const d = await download;
  expect(d.suggestedFilename()).toBe('untitled.ntx');
  // and it's kept in the browser all the same
  await saved(page);
  expect((await kept(page))[0].title).toBe('download me');
});
