/** The app says `listing`; the provider maps it to the API's `property`. */
import { createProvider } from './config.js';

const provider = createProvider('note');

/** Notes expose display authors only when the account is still resolvable. */
export const listNotes = async (entityType, entityId) =>
  (await provider()).listNotes(entityType, entityId);

/** Add a note. The author is taken from the caller's token, never from here. */
export const addNote = async (entityType, entityId, text, action) =>
  (await provider()).addNote(entityType, entityId, text, action);
