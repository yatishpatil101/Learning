package com.punenest.api.engagement.review;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * The closed key set for a review's per-aspect sub-ratings, and the validation that keeps it closed.
 *
 * <p><strong>Why JSONB with a vocabulary rather than five columns.</strong> The UI treats these as a
 * <em>sparse</em> map — {@code ReviewsSection.jsx} renders only the keys actually present, and
 * averages each aspect over only the reviews that answered it. Five nullable columns would model
 * that, but at the cost of a migration every time product wants a sixth aspect, on a table that is
 * pure user-generated content. JSONB matches the shape, and the schema already sets this precedent
 * ({@code saved_searches.filters}).
 *
 * <p><strong>Why the key set is still closed.</strong> "Schemaless" is how a column becomes a junk
 * drawer: once arbitrary keys are accepted, every consumer must defend against every key, the
 * contract stops describing the data, and nothing can ever be aggregated. The contract declares
 * {@code additionalProperties: false}; this class is where that is actually enforced, because
 * Bean Validation cannot express it over a {@code Map}.
 */
public final class ReviewCategories {

    private ReviewCategories() {
    }

    public static final String LOCALITY = "locality";
    public static final String CONDITION = "condition";
    public static final String VALUE = "value";
    public static final String OWNER = "owner";
    public static final String ACCURACY = "accuracy";

    /** Exactly the five keys the contract declares, and the five {@code RV_CATS} the UI renders. */
    public static final Set<String> KEYS = Set.of(LOCALITY, CONDITION, VALUE, OWNER, ACCURACY);

    private static final int MIN = 1;
    private static final int MAX = 5;

    /**
     * Validate and normalise a submitted category map.
     *
     * <p>Returns a new map containing only entries with a non-null value, key-sorted so that two
     * equivalent submissions serialise to identical JSON — otherwise the stored bytes would depend
     * on the client's field order, which makes the column impossible to compare or test against.
     *
     * @param submitted the raw map from the request body, possibly {@code null}
     * @return a normalised, possibly empty map — never {@code null}
     * @throws IllegalArgumentException if a key is unknown or a value is outside 1–5; the caller
     *                                  turns this into a 422 naming the offending key
     */
    public static Map<String, Integer> validated(Map<String, Integer> submitted) {
        Map<String, Integer> clean = new LinkedHashMap<>();
        if (submitted == null || submitted.isEmpty()) {
            return clean;
        }
        submitted.entrySet().stream()
                .sorted(Map.Entry.comparingByKey(Comparator.naturalOrder()))
                .forEach(e -> {
                    if (!KEYS.contains(e.getKey())) {
                        throw new IllegalArgumentException(
                                "Unknown review category '" + e.getKey() + "'; allowed: " + sortedKeys());
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
    private static String sortedKeys() {
        return KEYS.stream().sorted().toList().toString();
    }
}
