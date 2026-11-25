// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
    // GitHub Pages serves the site from /<repo>; the desktop app and `pnpm dev` from /
    paths: { base: process.env.BASE_PATH ?? "" },
    // registered by the page, and only in the browser (not in the desktop app)
    serviceWorker: { register: false },
  },
};

export default config;
