// `listSaved` returns full property view models for the pages that draw them; hearts and the count
// read `listSavedKeys` through `SavedContext`.
import { createProvider } from './config.js';

const provider = createProvider('saved');

/** The shortlist, newest save first. */
export const listSaved = async (opts) => (await provider()).listSaved(opts);

/** The whole shortlist as `{ token, uuid }`, newest save first: `token` is the routing id cards key on. */
export const listSavedKeys = async () => (await provider()).listSavedKeys();

/** Add to the shortlist. Idempotent. */
export const saveProperty = async (propertyId) => (await provider()).saveProperty(propertyId);

/** Remove from the shortlist. Idempotent. */
export const unsaveProperty = async (propertyId) => (await provider()).unsaveProperty(propertyId);
