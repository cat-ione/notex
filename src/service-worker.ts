/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Offline: the whole app is kept on the device the first time it's opened, so it opens
// without a connection (lecture wifi). The page itself is asked of the network first (a new
// version shows on a plain reload), and the kept copy is used when that fails or is slow.
import { base, build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `notex-${version}`;
/** The page itself (every address in the app is this one page) and everything it loads. */
const SHELL = `${base}/`;
const ASSETS = [SHELL, ...build, ...files];
/** How long the network gets to answer for the page before the kept copy is used. */
const PATIENCE_MS = 2500;

sw.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // any page of the app (with ?lab or not) is the one page: the network's, else the kept one
      if (req.mode === 'navigate') return (await fresh(cache)) ?? (await cache.match(SHELL)) ?? fetch(req);
      // (everything else is named by its contents: a kept copy is never out of date)
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })(),
  );
});

/** The page from the network (kept for next time), or null when it fails or takes too long. */
async function fresh(cache: Cache): Promise<Response | null> {
  const slow = new Promise<null>((r) => setTimeout(() => r(null), PATIENCE_MS));
  const got = fetch(SHELL, { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) return null;
      cache.put(SHELL, res.clone());
      return res;
    })
    .catch(() => null);
  return Promise.race([got, slow]);
}
