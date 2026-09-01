package com.draazy.api.moderation.property;

/**
 * The moderation console's headline counts, computed by the database over every listing.
 *
 * <p><strong>Why this exists rather than being folded client-side.</strong> The console used to
 * derive these five numbers from the rows {@code GET /admin/properties} had already returned. That
 * endpoint pages, and the page size is clamped to 100, so every counter silently meant "of the
 * newest hundred listings" while being labelled "Total", "Pending", "Flagged". A backlog that
 * grows past the page size is exactly the backlog somebody needs to be told about, and it was the
 * one case the old strip could not report: the numbers stopped moving and looked calm.
 *
 * <p>The counts are deliberately unfiltered by the console's search box. They are the state of the
 * platform, not of the current query — a moderator narrowing to one locality still needs to see
 * that four hundred listings are waiting overall, and a KPI strip that follows the filters is a
 * second copy of the table's own row count.
 *
 * @param total     every un-archived listing, including {@code sold} and {@code rented}
 * @param approved  live and in search
 * @param pending   awaiting a first moderation decision. {@code pending} is the only spelling of
 *                  that state — the console's {@code 'Under Review'} is a mock-side value the
 *                  {@code properties_status_check} constraint refuses
 * @param flagged   taken out of search by a moderator
 * @param featured  promoted onto the home page
 * @param recheck   approved listings with a stays-live re-check owed (Q14); counted separately
 *                  because these rows are live and raise none of the other counters
 * @param archived  soft-deleted; the one counter that is not a subset of {@code total}
 */
public record PropertyModerationSummary(
        long total,
        long approved,
        long pending,
        long flagged,
        long featured,
        long recheck,
        long archived) {
}
