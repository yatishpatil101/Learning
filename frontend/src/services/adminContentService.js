/** Admin reads use one flat item shape; public reads never return archived content. */
import { createProvider } from './config.js';

const provider = createProvider('adminContent');

/** The four types the API manages. Anything else is a 400 from the server, not a silent empty list. */
export const CONTENT_TYPES = ['announcements', 'services', 'faqs', 'banners'];

/** The console's edit modal is seeded with the whole row, and posting that back hands the server four fields
 * `ContentWrite` does not accept. */
const SERVER_OWNED = ['id', 'type', 'archived', 'createdAt'];

const writable = (body) => {
  const out = { ...(body || {}) };
  SERVER_OWNED.forEach((k) => { delete out[k]; });
  return out;
};

/** Every row of one type, archived ones included and told apart by `archived` rather than fetched separately — the
 * console shows both at once, and two requests would let the two halves disagree about the same row mid-edit. */
export const listContent = async (type) => (await provider()).listContent(type);

export const createContent = async (type, body) => (await provider()).createContent(type, writable(body));

/** Patch a row. Omitted fields are left alone; see the module docblock. */
export const updateContent = async (type, id, body) => (await provider()).updateContent(type, id, writable(body));

/** Hide a row without destroying it; resolves to the updated row. */
export const archiveContent = async (type, id) => (await provider()).archiveContent(type, id);

export const restoreContent = async (type, id) => (await provider()).restoreContent(type, id);
