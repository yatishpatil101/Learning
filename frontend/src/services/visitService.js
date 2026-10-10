/** One shape and one write for visits, since two client records of one event could disagree; `visitorMobile`
 * stays masked until the owner confirms, and nothing here can unmask it. */
import { createProvider } from './config.js';

const provider = createProvider('visit');

/** Visits the caller booked, newest first. */
export const listVisits = async (opts) => (await provider()).listVisits(opts);

/** Visits booked against listings the caller owns, newest first. */
export const myVisitRequests = async () => (await provider()).myVisitRequests();

/** Not idempotent: a second live visit on the same property is a 409, since silently moving a slot is worse. */
export const scheduleVisit = async (req) => (await provider()).scheduleVisit(req);

/** The server owns who may make which transition (409 otherwise); a client guard could only disagree with it. */
export const updateVisitStatus = async (id, status) => (await provider()).updateVisitStatus(id, status);

/** Either party may reschedule a live visit; the server 409s terminal ones, so no client-side guard is added. */
export const rescheduleVisit = async (id, when) => (await provider()).rescheduleVisit(id, when);
