package com.punenest.api.moderation.report;

import java.util.Set;

/**
 * The {@code reports.status} vocabulary — where a complaint sits in triage.
 *
 * <p>The legal transitions are declared here beside the values, per api-standards.md §7.1, so an
 * illegal move is a 422 with an explanation rather than a row quietly ending up in a state no queue
 * query looks for.
 */
public final class ReportStatuses {

    private ReportStatuses() {
    }

    /** Filed, nobody has looked at it. The state every report is created in. */
    public static final String OPEN = "open";

    /** A moderator has claimed it. Exists so two people do not work the same complaint twice. */
    public static final String REVIEWING = "reviewing";

    /** Upheld — something was done to the target. Terminal. */
    public static final String ACTIONED = "actioned";

    /** Rejected as unfounded, duplicate or vexatious. Terminal. */
    public static final String DISMISSED = "dismissed";

    /**
     * Reports still awaiting a decision. Also the set the V18 partial unique index uses to decide
     * whether a second report of the same target by the same person is a duplicate — the two must
     * agree, so the index names these same two values.
     */
    public static final Set<String> LIVE = Set.of(OPEN, REVIEWING);

    /** Decided. A terminal report is never reopened; a recurrence is a new report. */
    private static final Set<String> TERMINAL = Set.of(ACTIONED, DISMISSED);

    /** True if {@code value} is one of the four states. */
    public static boolean isValid(String value) {
        return OPEN.equals(value) || REVIEWING.equals(value)
                || ACTIONED.equals(value) || DISMISSED.equals(value);
    }

    /**
     * True if a report may move from {@code from} to {@code to}.
     *
     * <p>The one rule that matters is that terminal is terminal. Re-opening a decided complaint
     * erases the record that somebody judged it, and it is the obvious way for one moderator to
     * quietly undo a colleague's decision; filing afresh costs nothing and leaves both decisions
     * visible. Everything else is permitted, including {@code open -> actioned} (an obvious case
     * needs no ceremony) and restating the current state, which keeps the endpoint idempotent.
     */
    public static boolean canTransition(String from, String to) {
        if (!isValid(from) || !isValid(to)) {
            return false;
        }
        return !TERMINAL.contains(from) || from.equals(to);
    }
}
