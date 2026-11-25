// Works offline and installs as an app: the service worker keeps the app on the device.
import { test, expect, open, fresh, type, text, saved } from './helpers';
import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

/** Open the app and wait until its service worker serves it. */
async function installed(page: Page) {
  await open(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.waitForFunction(() => (window as any).__nx);
}

test('once visited, it opens with no connection', async ({ page, context }) => {
  await installed(page);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  await expect(page.locator('.block.h1')).toContainText('notex');
  await expect(page.locator('.math .katex').first()).toBeVisible();
  await expect(page.locator('.nx-err')).toHaveCount(0);
});

test('offline, math renders in its own fonts', async ({ page, context }) => {
  await installed(page);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  await page.evaluate(() => document.fonts.ready);
  const katexFonts = await page.evaluate(() => [...document.fonts].filter((f) => f.family.includes('KaTeX') && f.status === 'loaded').length);
  expect(katexFonts).toBeGreaterThan(0);
});

test('offline, notes are written and kept as usual', async ({ page, context }) => {
  await installed(page);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  await fresh(page);
  await type(page, 'written on the train');
  await saved(page);
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  expect(await text(page)).toBe('written on the train');
});

test('offline, any address in the app opens it', async ({ page, context }) => {
  await installed(page);
  await context.setOffline(true);
  await page.goto('/?lab&from=bookmark');
  await page.waitForFunction(() => (window as any).__nx);
  await expect(page.locator('.block.h1')).toContainText('notex');
});

test('it can be installed: a manifest with its name and icons', async ({ page, request }) => {
  await open(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const url = new URL(href!, page.url());
  const manifest = await (await request.get(url.href)).json();
  expect(manifest).toMatchObject({ name: 'notex', display: 'standalone', start_url: './' });
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, url).href);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /^#/);
});

test('without the service worker, nothing is cached (the tests run that way)', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await open(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  await context.close();
});
