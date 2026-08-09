/* Opening a stored document in a new tab.

   Uploaded documents are held as base64 data URLs. A `data:text/html;…` URL opened
   as a top-level document runs script in this origin, so the scheme is allowlisted
   to images and PDFs before it ever reaches the browser. The URL is assigned to the
   new tab's `location` rather than passed to `window.open(url)` — the tab is opened
   with `noopener` first, so the document can never reach back through `window.opener`.

   Storage is per-browser localStorage today, so a tampered value is self-inflicted
   rather than cross-user. That changes the day documents come from a server, which is
   exactly why the guard lives in one place instead of at each call site. */
// SVG is the one "image" type that is an active document (embedded <script>/onload runs when opened
// as a top-level document), so it is excluded from the passive-viewable allowlist.
const VIEWABLE_DATA_URL = /^data:(image\/(?!svg\b)[a-z0-9.+-]+|application\/pdf);base64,/i;

export const isViewableDoc = (url) => VIEWABLE_DATA_URL.test(url || '') || /^https?:\/\//i.test(url || '');

export function openDocUrl(url) {
  if (!isViewableDoc(url)) return false;
  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) return false;
  w.location.href = url;
  return true;
}
