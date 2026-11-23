// Images in a note: kept in it (as data URLs), so a note stays one file that opens
// anywhere. Big ones are scaled down and recompressed on the way in.

/** Longest side kept, in pixels: plenty for a page, and keeps notes small. */
const MAX_SIDE = 1600;
/** Files bigger than this are recompressed even when they're small enough in pixels. */
const MAX_BYTES = 700_000;

const readAsDataURL = (blob: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });

const load = (src: string) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => fail(new Error('not an image'));
    im.src = src;
  });

/**
 * An image file as something to put in a note: its data URL and the width to show it at
 * (its size on screen: a screenshot taken at 2× is shown at half its pixels).
 */
export async function imageSrc(file: Blob): Promise<{ src: string; w: number }> {
  const url = await readAsDataURL(file);
  const im = await load(url);
  const dpr = window.devicePixelRatio || 1;
  // animations and drawings stay as they are
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return { src: url, w: Math.round(im.naturalWidth / dpr) };
  const scale = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
  let src = url;
  if (scale < 1 || file.size > MAX_BYTES) {
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * scale);
    c.height = Math.round(im.naturalHeight * scale);
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
    // (webp where the browser can write it; it falls back to png by itself)
    const out = c.toDataURL('image/webp', 0.9);
    if (out.length < url.length) src = out;
  }
  return { src, w: Math.round((im.naturalWidth * scale) / dpr) };
}

/** Ask for image files (the system's file picker). */
export function pickImageFiles(): Promise<File[]> {
  return new Promise((ok) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => ok([...(input.files ?? [])]);
    input.click();
  });
}
