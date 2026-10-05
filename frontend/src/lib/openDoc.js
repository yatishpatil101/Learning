/* Only passive data URLs are viewable; active documents would run script in this origin. */
// SVG is the one "image" type that is an active document (embedded <script>/onload runs when opened
// as a top-level document), so it is excluded from the passive-viewable allowlist.
const VIEWABLE_DATA_URL = /^data:(image\/(?!svg\b)[a-z0-9.+-]+|application\/pdf);base64,/i;

/* Dev storage stubs do not resolve in-browser, so they must download instead of opening. */
const DEV_STORAGE_STUB = /^https?:\/\/mock\.storage\.local\b/i;

export const isViewableDoc = (url) => {
  const u = url || '';
  if (VIEWABLE_DATA_URL.test(u)) return true;
  // Root-relative is the dev store's signed URL; `//host` and `/\host` are other origins, so excluded.
  const sameOriginPath = /^\/(?![/\\])/.test(u);
  return (sameOriginPath || /^https?:\/\//i.test(u)) && !DEV_STORAGE_STUB.test(u);
};

const isDataUrl = (url) => /^data:/i.test(url);

// Chromium refuses a script-initiated top-frame navigation to any `data:` URL and leaves the tab
// blank, so the bytes are re-served as a same-origin `blob:` URL of the already-allowlisted type.
const toBlobUrl = (dataUrl) => {
  const [head, b64] = dataUrl.split(',');
  const type = head.slice(5, head.indexOf(';'));
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return url;
};

export function openDocUrl(url) {
  if (!isViewableDoc(url)) return false;
  /** A `noopener` feature returns null in Chromium even when the tab opened, so it cannot distinguish a valid preview
   * from a popup blocker. */
  const viewer = window.open('', '_blank');
  if (!viewer) return false;
  viewer.opener = null;
  viewer.location.replace(isDataUrl(url) ? toBlobUrl(url) : url);
  return true;
}
