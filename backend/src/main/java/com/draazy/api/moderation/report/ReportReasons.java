package com.draazy.api.moderation.report;

import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** Three report-reason vocabularies, one per target type — why {@code reports.reason} carries no
 * CHECK (V18). `npm run check:enums` parses the {@code Set.of(…)} literals below, so do not rename. */
public final class ReportReasons {

    private ReportReasons() {
    }

    /** Offered for every target type — the escape hatch that keeps {@code details} honest. */
    public static final String OTHER = "other";

    /** Mirrors {@code LISTING_REPORT_REASONS} in {@code frontend/src/lib/reportReasons.js}. */
    private static final Set<String> FOR_PROPERTY =
            Set.of("sold", "fake", "unavailable", "pricing", "spam", "broker", OTHER);

    /** Mirrors {@code OWNER_REPORT_REASONS}. */
    private static final Set<String> FOR_USER =
            Set.of("impersonation", "fraud", "brokerage", "abuse", "spam", "fakelistings", OTHER);

    /** Mirrors {@code SHARE_REPORT_REASONS}. */
    private static final Set<String> FOR_POST =
            Set.of("fake", "unavailable", "filled", "broker", "inappropriate", "spam", OTHER);

    /** Reviews have no reason set in the frontend yet; reusing the user vocabulary would be worse
     * than useless ({@code brokerage} says nothing about a review). */
    private static final Set<String> FOR_REVIEW = Set.of("fake", "abuse", OTHER);

    /** One set across all five society-hub kinds: the complaint does not change with the widget.
     * {@code personal} is unique to it — a recommendation naming a real tradesman's mobile number. */
    private static final Set<String> FOR_SOCIETY_CONTENT =
            Set.of("abuse", "spam", "fake", "personal", OTHER);

    /** @return the permitted reason codes, or an empty set for an unknown target type */
    public static Set<String> forTarget(String targetType) {
        if (ReportTargetTypes.isSocietyContent(targetType)) {
            return FOR_SOCIETY_CONTENT;
        }
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

    /** For the queue's reason filter, the one place the pair rule cannot apply: without it a
     * mistyped {@code ?reason=} returns an empty page indistinguishable from a clean queue. */
    public static boolean isKnown(String reason) {
        return ANY.contains(reason);
    }

    /** Every reason code the platform recognises, across all four target types. */
    private static final Set<String> ANY =
            Stream.of(FOR_PROPERTY, FOR_USER, FOR_POST, FOR_REVIEW, FOR_SOCIETY_CONTENT)
                    .flatMap(Set::stream)
                    .collect(Collectors.toUnmodifiableSet());
}
