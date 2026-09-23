// `listSaved` returns full property view models, not ids — ids would cost 31 requests for a
// shortlist of 30. There is no `isSaved(id)`: hearts read the set `SavedContext` holds in memory.
import { createProvider } from './config.js';

const provider = createProvider('saved');

/** The shortlist, newest save first. */
export const listSaved = async (opts) => (await provider()).listSaved(opts);

/** Add to the shortlist. Idempotent. */
export const saveProperty = async (propertyId) => (await provider()).saveProperty(propertyId);

/** Remove from the shortlist. Idempotent. */
export const unsaveProperty = async (propertyId) => (await provider()).unsaveProperty(propertyId);
