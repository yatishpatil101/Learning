/** Identity is the session, not the form: a body field would let anyone file a ticket in another's name.
 * Priority and image attachments are not on the wire, so the page must not offer them. */
import { createProvider } from './config.js';

const provider = createProvider('support');

/** Bare list, not paged: it grows with one person's own support history (api-standards §5.1). */
export const listTickets = async () => (await provider()).listTickets();

/** One ticket with its full thread, or null if it is not the caller's. */
export const getTicket = async (id) => (await provider()).getTicket(id);

/** Not `listTickets` with a wider scope: that array carries every message inline, so it would be a PII export.
 * Rows carry no thread, mobile or notes; a consumer session gets 403, so never call it from a consumer surface. */
export const listSupportQueue = async (opts) => (await provider()).listSupportQueue(opts);

export const createTicket = async (ticket) => (await provider()).createTicket(ticket);

/** Reply to a ticket. Resolves to the created message. */
export const replyToTicket = async (id, text) => (await provider()).replyToTicket(id, text);

/** The side comes from the session, never a parameter, which would let one side clear the other's flag. */
export const markTicketRead = async (id) => (await provider()).markTicketRead(id);
