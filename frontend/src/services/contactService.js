/* Contact requests are per listing; the server derives owner and enforces the unique key. */
import { createProvider } from './config.js';

const provider = createProvider('contact');

/** Read the gate for one listing. Safe for signed-out callers — they get `status: 'none'`. */
export const contactStatus = async (propertyId) => (await provider()).contactStatus(propertyId);

/** Ask this listing's owner for their number. Idempotent: asking twice returns the existing state rather than
 * stacking duplicate rows in the owner's inbox. */
export const requestContact = async (propertyId, message) => (await provider()).requestContact(propertyId, message);

/** The owner's inbox — requests against listings *they* own. Paged; read at the UI's bounded maximum by default. */
export const myContactRequests = async (opts) => (await provider()).myContactRequests(opts);

/** Approve or decline one request. `status` is 'approved' | 'declined'. */
export const respondToContactRequest = async (reqId, status) =>
  (await provider()).respondToContactRequest(reqId, status);
