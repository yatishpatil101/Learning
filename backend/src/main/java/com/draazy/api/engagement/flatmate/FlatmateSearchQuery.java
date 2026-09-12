package com.draazy.api.engagement.flatmate;

import java.util.List;

/**
 * Every facet the flatmate board offers, in one value — the line the client does not cross. Facets,
 * clamps and per-parameter semantics: docs/flows/consumer/flatmates.md §5.
 */
public record FlatmateSearchQuery(
        String tab,
        String q,
        String locality,
        Double nearLat,
        Double nearLng,
        Double nearRadiusKm,
        Long minBudget,
        Long maxBudget,
        String gender,
        boolean verifiedOnly,
        Integer moveInDays,
        List<String> habits,
        String attachedBath,
        Integer sharing,
        String sort,
        List<String> meLocalities,
        Long meBudget,
        String meGender) {

    /**
     * The widest circle the board will search. An unclamped radius turns a bounded index range into
     * a full scan; Pune is ~15km across, so 50 is generous and still cheap.
     */
    public static final double MAX_RADIUS_KM = 50.0;

    /**
     * The tightest circle the board will search — a privacy floor. An exact great-circle test with
     * an arbitrarily small radius trilaterates a group's flat out of a DTO that omits it.
     */
    public static final double MIN_RADIUS_KM = 0.5;

    /**
     * The longest move-in window the board will answer. Unclamped, {@code current_date + :moveInDays}
     * overflows the date type and Postgres raises — a 500 any anonymous caller can reach.
     */
    public static final int MAX_MOVE_IN_DAYS = 730;

    /**
     * The most values a repeated parameter may carry. Each element emits a predicate and a bind on
     * both halves of the union, so length sizes the SQL text on a route with no login.
     */
    public static final int MAX_LIST_VALUES = 12;

    /** Every sort the board offers. An unknown value falls back rather than 500s. */
    public static final String SORT_VERIFIED = "verified";
    public static final String SORT_NEWEST = "newest";
    public static final String SORT_BUDGET_LOW = "budget-low";
    public static final String SORT_BUDGET_HIGH = "budget-high";
    public static final String SORT_MATCH = "match";

    public FlatmateSearchQuery {
        tab = FlatmateVocabulary.resolveTab(tab, null);
        q = FlatmateVocabulary.blankToNull(q);
        locality = FlatmateVocabulary.blankToNull(locality);
        gender = oneOf(gender, FlatmateVocabulary.GENDER);
        attachedBath = oneOf(attachedBath, FlatmateVocabulary.ATTACHED_BATH);
        habits = cleanList(habits);
        /* A group cannot have fewer than one seat, so a zero or negative `sharing` is malformed
           rather than narrow — dropped like an unknown enum member. */
        sharing = sharing == null || sharing < 1 ? null : sharing;
        moveInDays = moveInDays == null ? null
                : Math.clamp(moveInDays, 0, MAX_MOVE_IN_DAYS);
        /* An unrecognised sort orders by trust rather than 400ing: a sort key comes from a query
           string, so it survives deep links, saved alerts and a release that renames one. */
        sort = switch (FlatmateVocabulary.blankToNull(sort) == null ? "" : sort) {
            case SORT_NEWEST, SORT_BUDGET_LOW, SORT_BUDGET_HIGH, SORT_MATCH -> sort;
            default -> SORT_VERIFIED;
        };
        meLocalities = cleanList(meLocalities);
        meGender = FlatmateVocabulary.blankToNull(meGender);
    }

    /**
     * A value the database could hold, or nothing. An unrecognised facet must be dropped: passing it
     * narrows to empty, which reads as "there is nothing here" rather than as the caller's typo.
     */
    private static String oneOf(String value, java.util.Set<String> allowed) {
        String clean = FlatmateVocabulary.blankToNull(value);
        if (clean == null) {
            return null;
        }
        String lower = clean.toLowerCase(java.util.Locale.ROOT);
        return allowed.contains(lower) ? lower : null;
    }

    private static List<String> cleanList(List<String> values) {
        return values == null ? List.of()
                : values.stream().map(FlatmateVocabulary::blankToNull)
                        .filter(java.util.Objects::nonNull).distinct()
                        .limit(MAX_LIST_VALUES).toList();
    }

    /** The unfiltered default page load — the request that must never be slow and never fail. */
    public static FlatmateSearchQuery emptyFor(String tab) {
        return new FlatmateSearchQuery(tab, null, null, null, null, null, null, null, null,
                false, null, List.of(), null, null, null, List.of(), null, null);
    }

    /**
     * Whether {@code match} has anything to score against. Without it every row ties, so the SQL
     * skips a scoring expression it would only tie on and falls through to recency.
     */
    public boolean scoresAgainstMe() {
        return SORT_MATCH.equals(sort)
                && (!meLocalities.isEmpty() || meBudget != null || meGender != null);
    }

    public boolean movingIn() {
        return FlatmateVocabulary.TAB_MOVE_IN.equals(tab);
    }

    /**
     * A centre without a radius and a radius without a centre are both incomplete questions, so
     * neither narrows anything. Mirrors {@code ListingFacets.hasNearPoint}.
     */
    public boolean hasNearPoint() {
        return nearLat != null && nearLng != null && nearRadiusKm != null && nearRadiusKm > 0;
    }

    public double effectiveRadiusKm() {
        return Math.clamp(nearRadiusKm, MIN_RADIUS_KM, MAX_RADIUS_KM);
    }

    /**
     * The same preference in the vocabulary a group speaks ({@code any|women|men}). Passing
     * {@code female} through matches no group at all; anything unrecognised returns null, which widens.
     */
    public String policy() {
        if (gender == null) {
            return null;
        }
        return switch (gender) {
            case "female" -> FlatmateVocabulary.POLICY_WOMEN;
            case "male" -> FlatmateVocabulary.POLICY_MEN;
            default -> null;
        };
    }
}
