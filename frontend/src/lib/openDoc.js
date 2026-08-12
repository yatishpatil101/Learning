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

/* The dev backend mints a vault signed URL against a storage stub host that does not resolve in the
   browser (documentMapper §1, D120). Opening it yields a blank tab with a DNS error rather than the
   "no preview" toast the caller wants, so it is not viewable. Production signed URLs sit on a real
   storage origin and open normally. This lived at one call site (`DocumentsTab`) and every other
   caller of `openDocUrl` was silently missing it — the point of this module is that the guard is
   in one place. */
const DEV_STORAGE_STUB = /^https?:\/\/mock\.storage\.local\b/i;

export const isViewableDoc = (url) => {
  const u = url || '';
  if (VIEWABLE_DATA_URL.test(u)) return true;
  return /^https?:\/\//i.test(u) && !DEV_STORAGE_STUB.test(u);
};

export function openDocUrl(url) {
  if (!isViewableDoc(url)) return false;
  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) return false;
  w.location.href = url;
  return true;
}
