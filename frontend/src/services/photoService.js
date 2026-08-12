/**
 * Photo Service — turns a chosen image file into a hosted URL for a listing's gallery.
 *
 * One operation crosses the seam: {@link uploadPhoto}. It exists because the create-listing wizard
 * needs a durable URL for each photo *before* the property is saved, and both providers return the
 * same `{ url }` shape so the wizard never learns which one is active.
 *
 * ## The two sides
 *
 * | Provider | What `uploadPhoto` returns | Notes |
 * |---|---|---|
 * | mock  | a base64 `data:` URL read in the browser | the app's default with no backend; the URL lives only in the tab, exactly as the wizard behaved before this slice |
 * | http  | a permanent CDN URL from the public R2 bucket | `POST /me/photos` (multipart); self-scoped by the JWT, image-only, 5 MB cap enforced server-side |
 *
 * The photo domain is opt-in like every other: it stays on the mock until `photo` is named in
 * `VITE_API_DOMAINS`, so the offline demo is untouched.
 */
import { createProvider } from './config.js';

const provider = createProvider('photo');

/**
 * Upload one image and resolve to its hosted URL.
 *
 * @param {File|Blob} file the image the owner picked; the caller has already applied the picker's
 *                        type/size guard, and the http provider is re-validated server-side
 * @returns {Promise<{ url: string }>} the stored photo's URL — a `data:` URL in mock mode, a CDN URL
 *                        in http mode
 */
export const uploadPhoto = async (file) => (await provider()).uploadPhoto(file);
