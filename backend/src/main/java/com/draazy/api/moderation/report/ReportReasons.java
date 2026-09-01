package com.draazy.api.moderation.report;

import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

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
 * <p>Values are the machine codes the frontend already submits (the left element of each pair in
 * {@code frontend/src/lib/reportReasons.js}); the human-readable label is the client's business,
 * not the API's. The two sides are diffed set-by-set by {@code frontend/scripts/report-parity.mjs},
 * which parses the {@code Set.of(…)} literals below — so the mirroring is checked rather than
 * merely asserted in a comment.
 */
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

    /**
     * Reviews have no reason set in the frontend yet — nothing reports one today, because nothing
     * could act on the result until this slice added the takedown. Reusing the user vocabulary
     * would be worse than useless ({@code brokerage} says nothing about a review), so the set is
     * the honest minimum: the two complaints actually made about reviews, plus the escape hatch.
     */
    private static final Set<String> FOR_REVIEW = Set.of("fake", "abuse", OTHER);

    /**
     * Society-hub content — recommendations, replies, questions, answers, noticeboard items.
     *
     * <p>One set across all five kinds, unlike the target types themselves, because the complaint a
     * neighbour makes does not change with the widget: abuse in an answer and abuse on the
     * noticeboard are the same abuse. The kinds are separate only so that a moderator can act on
     * the right row.
     *
     * <p>{@code personal} is the one that does not appear anywhere else, and it is the reason this
     * set is not the review set. The single most damaging thing on a society hub is a recommendation
     * naming a real tradesman with his real mobile number — published by a neighbour, about somebody
     * who never agreed to appear on the site and has no account with which to object.
     */
    private static final Set<String> FOR_SOCIETY_CONTENT =
            Set.of("abuse", "spam", "fake", "personal", OTHER);

    /**
     * The reasons legal for one target type.
     *
     * @param targetType one of {@link ReportTargetTypes}
     * @return the permitted reason codes, or an empty set for an unknown target type — which the
     *         caller has already rejected, since target type is validated first
     */
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

    /**
     * True if {@code reason} is a recognised complaint about <em>anything</em>.
     *
     * <p>Exists for the queue's reason filter, which is the one place the pair rule cannot be
     * applied: a moderator may filter by reason without also filtering by target type, and at that
     * point there is no second column to validate against. The union is the strongest statement
     * still available, and it is worth making — without it a mistyped {@code ?reason=} returns an
     * empty page that is indistinguishable from a clean queue, which is exactly the reading a
     * moderator must not be given.
     */
    public static boolean isKnown(String reason) {
        return ANY.contains(reason);
    }

    /** Every reason code the platform recognises, across all four target types. */
    private static final Set<String> ANY =
            Stream.of(FOR_PROPERTY, FOR_USER, FOR_POST, FOR_REVIEW, FOR_SOCIETY_CONTENT)
                    .flatMap(Set::stream)
                    .collect(Collectors.toUnmodifiableSet());
}
