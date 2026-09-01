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
 * @param ticketPickup           how long a service request waits before somebody owns it
 * @param ticketDelivery         how long a service request takes to finish
 * @param conciergeToLive        how long a staff-posted listing takes to go live
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
        List<PendingListing> worstPending,
        Track ticketPickup,
        Track ticketDelivery,
        Track conciergeToLive) {

    /**
     * One turnaround measurement, in the shape the nine fields above already have.
     *
     * <p><strong>Why a nested record and not nine more flat fields.</strong> Three more tracks
     * flattened would be twenty-seven fields on one record with names like
     * {@code avgHoursToPickup} / {@code avgHoursToDeliver} / {@code avgHoursToLive} — three
     * spellings of one idea, which is exactly how a client ends up reading the wrong one. The
     * listing-review fields stay flat because they were already on the wire and renaming them
     * would break a screen and two specs to buy symmetry; the docblock is the cheaper way to say
     * they are the same shape.
     *
     * <p><strong>Every nullable field means the same thing it does above:</strong> nothing has been
     * completed, so there is no turnaround to report. Null rather than zero, for the reason the
     * record's own docblock gives — the generator this replaces returned {@code 0h} average and
     * {@code 100%} compliance for a desk that had never closed a ticket.
     *
     * @param targetHours               the policy this track is judged against, served for the same
     *                                  reason {@link SlaSummary#targetHours} is
     * @param completedCount            work items that reached the end state, within the window
     * @param avgHours                  mean turnaround, one decimal; null when nothing completed
     * @param medianHours               the median, which is the figure worth reading; null likewise
     * @param breachedCount             completed items that took longer than {@code targetHours}
     * @param slaRatePct                percentage inside the target; null, not 100, when empty
     * @param outstandingCount          items still waiting right now. Unwindowed, like
     *                                  {@link SlaSummary#pendingCount} and for the same reason: a
     *                                  backlog is present tense, and a window would drop the oldest
     * @param outstandingBreachingCount of those, the ones already past the target
     */
    public record Track(
            int targetHours,
            long completedCount,
            Double avgHours,
            Double medianHours,
            long breachedCount,
            Integer slaRatePct,
            long outstandingCount,
            long outstandingBreachingCount) {
    }

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
