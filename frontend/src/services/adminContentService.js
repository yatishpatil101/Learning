/** Admin reads use one flat item shape; public reads never return archived content. */
import { createProvider } from './config.js';

const provider = createProvider('adminContent');

/** The console's edit modal is seeded with the whole row, and posting that back hands the server four fields
 * `ContentWrite` does not accept. */
const SERVER_OWNED = ['id', 'type', 'archived', 'createdAt'];

const writable = (body) => {
  const out = { ...(body || {}) };
  SERVER_OWNED.forEach((k) => { delete out[k]; });
  return out;
};

/** One half of one type: `archived: false` the live rows, `true` the archived ones; omitted, both. Rows carry no
 * translations unless `translations: true`. */
export const listContent = async (type, opts) => (await provider()).listContent(type, opts);

export const createContent = async (type, body) => (await provider()).createContent(type, writable(body));

/** Patch a row. Omitted fields are left alone; see the module docblock. */
export const updateContent = async (type, id, body) => (await provider()).updateContent(type, id, writable(body));

/** Hide a row without destroying it; resolves to the updated row. */
export const archiveContent = async (type, id) => (await provider()).archiveContent(type, id);

export const restoreContent = async (type, id) => (await provider()).restoreContent(type, id);
