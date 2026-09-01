package com.punenest.api.admin;

import java.util.List;

/**
 * Moderation turnaround against the review SLA — the measured replacement for a seeded constant.
 *
 * <p><strong>Nulls are the message, so they are serialised.</strong> This record deliberately does
 * <em>not</em> carry {@code @JsonInclude(NON_NULL)}, unlike {@link SupplyGapRow}. Every nullable
 * field here means "nothing has been reviewed yet", and that is a finding an operator needs to see
 * as an explicit blank rather than as an absent key the UI renders as a dash it cannot distinguish
 * from a bug. An omitted field says "this endpoint has changed"; an explicit {@code null} says "the
 * queue has not been worked". Those are different problems.
 *
 * <p><strong>Why not zero.</strong> {@code avgHoursToReview} of {@code 0} reads as instantaneous
 * review and {@code slaRatePct} of {@code 100} reads as a perfect record — both are claims the
 * platform would be making about a team that has decided nothing. The mock this replaces returned
 * exactly those two figures on an empty queue, which meant a brand-new deployment reported flawless
 * SLA compliance. Null is the only honest answer to "how long did the reviews take" when there were
 * none.
 *
 * @param targetHours            the review SLA, in hours. Served rather than left to the client so
 *                               that "breached" means the same thing on the server that computed it
 *                               and on the screen that colours it red — the tab this replaces
 *                               hardcoded 24 in the browser, so moving the target would have needed
 *                               a frontend deploy to take effect on a number the server had already
 *                               changed its mind about
 * @param reviewedCount          listings that reached {@code approved} or {@code rejected} and have
 *                               a recorded decision, within the window if one was given
 * @param avgHoursToReview       mean turnaround, one decimal place; null when nothing was reviewed
 * @param medianHoursToReview    the median, which is the figure worth reading: one listing that sat
 *                               for three weeks over a holiday drags a mean of twenty far enough to
 *                               hide a team that is otherwise inside the target. Null when nothing
 *                               was reviewed
 * @param breachedCount          reviewed listings whose turnaround exceeded {@link #targetHours}
 * @param slaRatePct             percentage of reviewed listings inside the target; null, not 100,
 *                               when nothing was reviewed
 * @param pendingCount           listings awaiting a decision right now. Deliberately unaffected by
 *                               the window: a backlog is a present-tense fact, and narrowing it to
 *                               "pending listings created in the last 30 days" would drop the
 *                               oldest — the exact rows the number exists to surface
 * @param pendingBreachingCount  of those, the ones already older than the target. The one figure on
 *                               this report an ops lead can act on today
 * @param worstPending           the oldest waiting listings, longest first, capped. A count tells
 *                               somebody to act; this tells them what to open
 */
public record SlaSummary(
        int targetHours,
        long reviewedCount,
        Double avgHoursToReview,
        Double medianHoursToReview,
        long breachedCount,
        Integer slaRatePct,
        long pendingCount,
        long pendingBreachingCount,
        List<PendingListing> worstPending) {

    /**
     * One listing still waiting on a decision.
     *
     * <p>Owner and locality are absent on purpose. This is a work queue, not a listing feed: the id
     * is enough to open the record and the title is enough to recognise it, and anything more turns
     * an ops metric into a second, unpaginated and unfiltered export of the property table.
     *
     * @param id           the listing's uuid, as text — what the moderation route takes
     * @param title        for recognition in the queue
     * @param hoursWaiting age since {@code created_at}, one decimal place
     */
    public record PendingListing(String id, String title, double hoursWaiting) {
    }
}
