/**
 * Staff Activity — the back-office review surface.
 *
 * <p>Two reads, both administrator-only:
 *
 *   GET /admin/staff-activity          the feed: one row per back-office action, paged, newest first
 *   GET /admin/staff-activity/summary  totals, the per-entity split, the action vocabulary, the
 *                                      leaderboard — all aggregated by the database
 *
 * Both take the same filter set (actor, entity, action, from, to, q), so a narrowed console can ask
 * for a headline about what it is actually showing.
 *
 * Why a summary endpoint at all: the page this replaces counted its own KPI tiles and built its own
 * leaderboard by folding the rows it had already fetched. That makes "total activities" mean "rows
 * in memory" and makes the leaderboard a ranking of the current page rather than of the team. Those
 * are not display bugs — they are the wrong numbers, printed confidently.
 *
 * Not to be confused with the audit log seam. Same table, same permission; different question. The
 * audit log answers "what has happened to this record", which is a case. This answers "what has this
 * colleague been doing", which is a review, and it is the only one of the two that needs a name.
 */
import { createProvider } from './config.js';

const provider = createProvider('staffActivity');

export async function listStaffActivity(params) {
  return (await provider()).listStaffActivity(params);
}

export async function getStaffActivitySummary(params) {
  return (await provider()).getStaffActivitySummary(params);
}
