import { get, patch, unwrapPage } from '../../http.js';

export async function listErasureRequests({ status, page = 0, size = 20 } = {}) {
  const query = { page, size };
  if (status) query.status = status;
  return unwrapPage(await get('/admin/erasure-requests', query), { page, size });
}

// `decision` is the server word: `execute` or `reject`; a reject needs a note.
export const decideErasureRequest = (id, decision, note) => {
  const body = { decision };
  if (note && note.trim()) body.note = note.trim();
  return patch(`/admin/erasure-requests/${encodeURIComponent(id)}`, body);
};
