import { postMultipart } from '../../http.js';

// The platform supplies the multipart boundary; the server scopes storage to the session.
export async function uploadPhoto(file, options) {
  const form = new FormData();
  form.append('file', file);
  const res = await postMultipart('/me/photos', form, options);
  if (!res?.url) throw new Error('The photo upload did not return a usable URL. Please try again.');
  return { url: res.url };
}
