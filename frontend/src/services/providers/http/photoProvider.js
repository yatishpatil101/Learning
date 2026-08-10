/**
 * HTTP photo provider — the live counterpart to `providers/mock/photoProvider.js`.
 *
 * The method name, argument and return shape mirror the mock exactly; `photoService.js` is the only
 * contract between them, and the list-property wizard may not care which is active.
 *
 *   | Operation | Endpoint |
 *   |---|---|
 *   | upload one image | `POST /me/photos` (multipart) |
 *
 * The endpoint is self-scoped by the JWT (no owner id in the path), stores the image in the public
 * R2 bucket, and returns `{ url }` — a permanent CDN URL the wizard drops straight into a listing's
 * `images`, in place of the mock's throwaway `data:` URL. Image type and the 5 MB cap are enforced
 * server-side, so a file that slips past the picker hint is still rejected with a 415/413.
 */
import { postMultipart } from '../../http.js';

/**
 * Upload one image and resolve to its CDN URL.
 *
 * @param {File|Blob} file the image; the platform sets the multipart boundary and `Content-Type`.
 * @returns {Promise<{ url: string }>}
 */
export async function uploadPhoto(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await postMultipart('/me/photos', form);
  return { url: res?.url ?? null };
}
