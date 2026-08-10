/**
 * Mock photo provider — the offline counterpart to `providers/http/photoProvider.js`, and the
 * default the app runs on with no backend.
 *
 * It reproduces exactly what the list-property wizard used to do inline: read the chosen file into a
 * base64 `data:` URL in the browser. The URL lives only in the current tab (and whatever the wizard
 * persists to `localStorage`), never touching a server — so the offline demo behaves as it always
 * has. The seam speaks in `File`s (what the multipart endpoint needs); the mock is where a file
 * becomes a `data:` URL, the http provider is where it becomes a CDN URL.
 */

/** Read a `File`/`Blob` as a base64 `data:` URL. */
function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || typeof FileReader === 'undefined') {
      reject(new Error('No file to read'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload one image — mock: resolve to its inline `data:` URL, matching the http provider's `{ url }`.
 */
export async function uploadPhoto(file) {
  return { url: await readDataUrl(file) };
}
