package com.punenest.api.engagement.review;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * The closed key sets for a review's per-aspect sub-ratings, and the validation that keeps them
 * closed — <strong>one vocabulary per target type</strong>.
 *
 * <p><strong>Why JSONB with a vocabulary rather than five columns.</strong> The UI treats these as a
 * <em>sparse</em> map — {@code ReviewsSection.jsx} renders only the keys actually present, and
 * averages each aspect over only the reviews that answered it. Five nullable columns would model
 * that, but at the cost of a migration every time product wants a sixth aspect, on a table that is
 * pure user-generated content. JSONB matches the shape, and the schema already sets this precedent
 * ({@code saved_searches.filters}). It is also what makes <em>this</em> change free of a migration:
 * a second vocabulary is a second set of keys in the same document, not a second set of columns.
 *
 * <p><strong>Why the key sets are still closed.</strong> "Schemaless" is how a column becomes a junk
 * drawer: once arbitrary keys are accepted, every consumer must defend against every key, the
 * contract stops describing the data, and nothing can ever be aggregated. The contract declares
 * {@code additionalProperties: false}; this class is where that is actually enforced, because
 * Bean Validation cannot express it over a {@code Map}.
 *
 * <p><strong>Why one vocabulary was wrong.</strong> {@code locality / condition / value / owner /
 * accuracy} describes a <em>listing</em>. Applied to a housing society those words mean nothing —
 * you cannot rate a society's "accuracy", and its "owner" is not a party to anything. The society
 * hub has always named a different five ({@code REVIEW_CATS} in
 * {@code pages/consumer/society/constants.js}: Safety, Maintenance, Management, Amenities,
 * Connectivity) and rendered bars for them; because those ids were not in the server's vocabulary,
 * every one of those bars had nothing behind it and fell back to the baseline estimate. The hook's
 * own comment named the gap. This class closes it by making the vocabulary a function of the
 * target, so that a key valid for a property is <em>refused</em> for a society and vice versa —
 * dropping it silently would leave the write returning 201 and the bar rendering empty, which is
 * precisely the class of failure nobody reports.
 *
 * <p><strong>{@code locality} and {@code owner} keep the property vocabulary, and that is a
 * deliberate non-decision.</strong> Neither surface renders per-aspect bars at all — a search for
 * {@code catAvg} finds only the property page and the society hub — so the product has never named
 * a vocabulary for them. Inventing one here would be putting words in product's mouth; changing
 * theirs would be a behaviour change nothing asked for. They therefore keep exactly what they
 * accept today, and the question is left open rather than answered by a commit.
 */
public final class ReviewCategories {

    private ReviewCategories() {
    }

    // ------------------------------------------------------------- property aspects

    public static final String LOCALITY = "locality";
    public static final String CONDITION = "condition";
    public static final String VALUE = "value";
    public static final String OWNER = "owner";
    public static final String ACCURACY = "accuracy";

    /**
     * The five aspects a <em>listing</em> is rated on — the {@code RV_CATS} of
     * {@code pages/consumer/property/ReviewsSection.jsx}.
     *
     * <p>Also the vocabulary for {@code locality} and {@code owner} targets, unchanged, because
     * nothing in the product names one for them. See the class Javadoc.
     */
    public static final Set<String> PROPERTY_KEYS =
            Set.of(LOCALITY, CONDITION, VALUE, OWNER, ACCURACY);

    // -------------------------------------------------------------- society aspects

    /**
     * Capitalised because the UI's ids are.
     *
     * <p>{@code constants.js} states the rule these have to obey: "Review categories are stored on
     * each review as the <em>category id</em>, so these ids must stay stable English — renaming one
     * would orphan every stored rating." The label a reader sees comes from {@code society.cat<Id>}
     * in the locale files. Lower-casing them on the wire would be a mapping this file invented, and
     * one more place for a key to go missing between the bar and the column.
     */
    public static final String SAFETY = "Safety";
    public static final String MAINTENANCE = "Maintenance";
    public static final String MANAGEMENT = "Management";
    public static final String AMENITIES = "Amenities";
    public static final String CONNECTIVITY = "Connectivity";

    /** The five aspects a <em>society</em> is rated on — {@code REVIEW_CATS} in the hub. */
    public static final Set<String> SOCIETY_KEYS =
            Set.of(SAFETY, MAINTENANCE, MANAGEMENT, AMENITIES, CONNECTIVITY);

    private static final int MIN = 1;
    private static final int MAX = 5;

    /**
     * The aspects a review of {@code targetType} may carry.
     *
     * <p>The same method feeds the write path's validation and the read path's aggregate, on
     * purpose: {@code ReviewRepository#categoryAveragesFor} pins its result to a key list, so a
     * vocabulary that were enforced on write but not on read would still publish a stale key, and
     * one enforced on read but not on write would accept a rating it then never shows.
     *
     * @param targetType one of {@link ReviewTargetTypes}; anything else falls back to the property
     *                   vocabulary, which is what {@code locality} and {@code owner} legitimately
     *                   use and what an unrecognised type would have got before this split
     */
    public static Set<String> forTarget(String targetType) {
        return ReviewTargetTypes.SOCIETY.equals(targetType) ? SOCIETY_KEYS : PROPERTY_KEYS;
    }

    /**
     * Validate and normalise a submitted category map against the vocabulary of its target.
     *
     * <p>Returns a new map containing only entries with a non-null value, key-sorted so that two
     * equivalent submissions serialise to identical JSON — otherwise the stored bytes would depend
     * on the client's field order, which makes the column impossible to compare or test against.
     *
     * @param targetType the type of thing being reviewed; decides which keys are legal
     * @param submitted  the raw map from the request body, possibly {@code null}
     * @return a normalised, possibly empty map — never {@code null}
     * @throws IllegalArgumentException if a key is unknown <em>for this target type</em> or a value
     *                                  is outside 1–5; the caller turns this into a 400 naming the
     *                                  offending key and the vocabulary that would have accepted it
     */
    public static Map<String, Integer> validated(String targetType,
            Map<String, Integer> submitted) {
        Set<String> allowed = forTarget(targetType);
        Map<String, Integer> clean = new LinkedHashMap<>();
        if (submitted == null || submitted.isEmpty()) {
            return clean;
        }
        submitted.entrySet().stream()
                .sorted(Map.Entry.comparingByKey(Comparator.naturalOrder()))
                .forEach(e -> {
                    if (!allowed.contains(e.getKey())) {
                        // Naming the target type matters: `locality` is a perfectly good key, just
                        // not for a society, and "unknown category" alone would read as a typo.
                        throw new IllegalArgumentException(
                                "Unknown review category '" + e.getKey() + "' for a " + targetType
                                        + " review; allowed: " + sortedKeys(allowed));
                    }
                    Integer v = e.getValue();
                    if (v == null) {
                        return;
                    }
                    if (v < MIN || v > MAX) {
                        throw new IllegalArgumentException(
                                "Review category '" + e.getKey() + "' must be between "
                                        + MIN + " and " + MAX + ", got " + v);
                    }
                    clean.put(e.getKey(), v);
                });
        return clean;
    }

    /** The allowed keys in a stable order, for an error message the caller can act on. */
    private static String sortedKeys(Set<String> allowed) {
        return allowed.stream().sorted().toList().toString();
    }
}
