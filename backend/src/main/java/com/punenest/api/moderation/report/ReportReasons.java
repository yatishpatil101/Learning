package com.punenest.api.moderation.report;

import java.util.Set;

/**
 * The report-reason vocabulary — <strong>three</strong> vocabularies, one per target type.
 *
 * <p>This is why {@code reports.reason} deliberately carries no CHECK constraint (see V18). The
 * frontend's {@code ReportModal.jsx} ships a different reason set for each kind of target, and they
 * only partly overlap: {@code pricing} is a meaningful complaint about a listing and meaningless
 * about a person, {@code impersonation} the reverse. A single flat CHECK over the union of all
 * three would accept every nonsensical pairing while appearing to validate something. The real rule
 * is "this reason must be valid <em>for this target type</em>", which is a two-column rule, so it is
 * enforced here where both columns are in hand.
 *
 * <p>Unlike a uniqueness rule, a vocabulary rule has no race to lose: there is no interleaving of
 * two requests that turns two individually-valid reasons into an invalid pair. That is what makes a
 * service-level check sufficient here and insufficient in V9/V16 — worth keeping straight, because
 * "always push it into the database" is the wrong lesson to draw from those two.
 *
 * <p>Values are the machine codes the frontend already submits (the left element of each
 * {@code ReportModal} pair); the human-readable label is the client's business, not the API's.
 */
public final class ReportReasons {

    private ReportReasons() {
    }

    /** Offered for every target type — the escape hatch that keeps {@code details} honest. */
    public static final String OTHER = "other";

    /** Mirrors {@code LISTING_REPORT_REASONS} in {@code components/ReportModal.jsx}. */
    private static final Set<String> FOR_PROPERTY =
            Set.of("sold", "fake", "unavailable", "pricing", "spam", "broker", OTHER);

    /** Mirrors {@code OWNER_REPORT_REASONS}. */
    private static final Set<String> FOR_USER =
            Set.of("impersonation", "fraud", "brokerage", "abuse", "spam", "fakelistings", OTHER);

    /** Mirrors {@code SHARE_REPORT_REASONS}. */
    private static final Set<String> FOR_POST =
            Set.of("fake", "unavailable", "filled", "broker", "inappropriate", "spam", OTHER);

    /**
     * Reviews have no reason set in the frontend yet — nothing reports one today, because nothing
     * could act on the result until this slice added the takedown. Reusing the user vocabulary
     * would be worse than useless ({@code brokerage} says nothing about a review), so the set is
     * the honest minimum: the two complaints actually made about reviews, plus the escape hatch.
     */
    private static final Set<String> FOR_REVIEW = Set.of("fake", "abuse", OTHER);

    /**
     * The reasons legal for one target type.
     *
     * @param targetType one of {@link ReportTargetTypes}
     * @return the permitted reason codes, or an empty set for an unknown target type — which the
     *         caller has already rejected, since target type is validated first
     */
    public static Set<String> forTarget(String targetType) {
        return switch (targetType == null ? "" : targetType) {
            case ReportTargetTypes.PROPERTY -> FOR_PROPERTY;
            case ReportTargetTypes.USER -> FOR_USER;
            case ReportTargetTypes.POST -> FOR_POST;
            case ReportTargetTypes.REVIEW -> FOR_REVIEW;
            default -> Set.of();
        };
    }

    /** True if {@code reason} is a recognised complaint about a {@code targetType}. */
    public static boolean isValid(String targetType, String reason) {
        return forTarget(targetType).contains(reason);
    }
}
