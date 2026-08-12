/**
 * Report Service — abuse reports: the consumer's complaint and the ops queue that answers it.
 *
 * `POST /reports` (any signed-in caller) · `GET /reports` (**staff/admin, paged**) ·
 * `PATCH /reports/{id}` (**staff/admin**, triage).
 *
 * Three endpoints, and the first domain in the seam where **the two ends have different
 * audiences**: anyone may file, only ops may read. That asymmetry is the shape of the module —
 * `listReports` and `triageReport` will 403 for a consumer, by design, and no consumer surface
 * calls them.
 *
 * ## Target types, and the one the client was getting wrong
 *
 * The server accepts four: `property`, `user`, `review`, `post`. The client calls them "kinds" and
 * ships three reason vocabularies. They line up like this:
 *
 * | Modal reasons | Server target | Used by |
 * |---|---|---|
 * | `LISTING_REPORT_REASONS` | `property` | property page |
 * | `OWNER_REPORT_REASONS` | `user` | owner profile |
 * | `SHARE_REPORT_REASONS` | **`post`** | flatmates |
 *
 * `Flatmates.jsx` passed `kind='user'` with `SHARE_REPORT_REASONS`. The mock stores whatever it is
 * handed, so nothing complained — but the server validates the reason *against the target type*,
 * and `filled` is not a thing you can say about a person. Every flatmate report would have been a
 * 400. See `reportMapper.js`.
 *
 * ## Status vocabulary
 *
 * Server: `open → reviewing → actioned | dismissed`. **Terminal is terminal** — a decided report
 * cannot be reopened, because that erases the record that somebody judged it. The admin queue had a
 * `resolved` status the server has never heard of and a "Reopen" button the server refuses; both are
 * reconciled in the mapper and the queue rather than silently failing.
 *
 * ## Shape
 *
 * `listReports` returns `{ items, total, page, size }`; `createReport` and `triageReport` resolve to
 * a single report. Items are view models in the queue's existing vocabulary:
 *
 *   { id, kind, targetId, targetTitle, targetOwner, reason, reasonLabel, details, status,
 *     actionTaken, at, handledAt, reportedBy }
 *
 * The denormalised display fields (`targetTitle`, `targetOwner`, `reportedBy`) are **not on the
 * wire** and are not invented — see the mapper for what each degrades to and why.
 */
import { createProvider } from './config.js';

const provider = createProvider('report');

/**
 * File a report. Any signed-in caller.
 *
 * **Rejects a duplicate**: the server refuses a second live report of the same target by the same
 * person with a 409. The provider surfaces that as a `'duplicate'` result rather than throwing, so
 * the modal can say something true instead of thanking the user for a report nobody received.
 *
 * @param {{kind: string, targetId: string, reason: string, details?: string}} report
 * @returns {Promise<object|'duplicate'>}
 */
export const createReport = async (report) => (await provider()).createReport(report);

/**
 * The moderation queue, newest first. **Staff/admin only** — 403 for anyone else.
 *
 * @param {{status?: string, page?: number, size?: number}} [opts]
 * @returns {Promise<{items: object[], total: number, page: number, size: number}>}
 */
export const listReports = async (opts) => (await provider()).listReports(opts);

/**
 * Move a report through triage. **Staff/admin only.**
 *
 * @param {string} id
 * @param {{status: string, note?: string}} decision
 * @returns {Promise<object>} the updated report
 */
export const triageReport = async (id, decision) => (await provider()).triageReport(id, decision);
