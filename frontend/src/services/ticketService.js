/** Ops work board, not `supportService`'s customer tickets; it renders server data or fails visibly, since
 * a local fallback needs a hand-kept second status vocabulary that drifts. */
import { createProvider } from './config.js';

const provider = createProvider('ticket');

/** Sort is fixed server-side and index-backed; sending `?sort=` is an unmapped-property 500. */
export const listTicketQueue = async (opts) => (await provider()).listTicketQueue(opts);

/** { open, inProgress, waiting, resolved, closed, all } for the caller's desk scope. */
export const getTicketSummary = async (team) => (await provider()).getTicketSummary(team);

/** One ticket with its internal notes and values. Rows from listTicketQueue carry neither. */
export const getTicket = async (id) => (await provider()).getTicket(id);

/** Self-claim only: assigning to someone else needs a staff directory the ops portal lacks, and re-teaming
 * routinely removes the ticket from the assigner's own view. */
export const claimTicket = async (id, userId) => (await provider()).claimTicket(id, userId);

/** Move a ticket to one of the server's five statuses. */
export const setTicketStatus = async (id, status) => (await provider()).setTicketStatus(id, status);

/** Returns the note, not the ticket: resending all `notes` would let the second saver erase the first. */
export const addTicketNote = async (id, text) => (await provider()).addTicketNote(id, text);

/** Any authenticated caller may raise one: a queue only privileged people can write to collects nothing. */
export const createTicket = async (data) => (await provider()).createTicket(data);

/** Works without a sign-in; team, subject and priority derive from the slug server-side so an anonymous
 * caller cannot choose which desk it pages. */
export const joinServiceWaitlist = async (data) => (await provider()).joinServiceWaitlist(data);
