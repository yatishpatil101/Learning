package com.punenest.api.catalog.property;

import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * "How many live listings does this locality / society / city have?", answered for the whole
 * catalogue in one query per question.
 *
 * <p><strong>Why this is computed rather than read from a column.</strong> The schema carries
 * {@code listing_count} on {@code localities}, {@code societies} and {@code cities}, and no code has
 * ever written to any of them. When slice 7 was planned, three of fifteen localities already
 * disagreed with the properties table — and the disagreement was not staleness. The stored number
 * counts <em>every</em> property; every surface that displays it means approved, unarchived ones.
 * A stale counter can be refreshed, but a counter that measures the wrong thing was wrong on the day
 * it was written, and it is worse than no counter because it looks trustworthy.
 *
 * <p><strong>Why a map and not a count-per-row.</strong> Each accessor is a single grouped aggregate
 * over an indexed predicate, returned as a lookup table. Callers resolve their rows against it
 * in memory. The obvious alternative — asking for a count while mapping each locality — is an N+1
 * on an <em>unauthenticated</em> endpoint, which is a denial-of-service anyone can trigger for free.
 *
 * <p>Absent keys mean zero: a locality with no live listing simply has no group.
 */
@Service
public class ListingCounts {

    private final PropertyRepository properties;

    public ListingCounts(PropertyRepository properties) {
        this.properties = properties;
    }

    /** Live-listing count per locality slug. Keys absent from the map have none. */
    @Transactional(readOnly = true)
    public Map<String, Long> byLocalitySlug() {
        return toMap(properties.countLiveByLocalitySlug(PropertyStatus.APPROVED), k -> (String) k);
    }

    /** Live-listing count per society id. Keys absent from the map have none. */
    @Transactional(readOnly = true)
    public Map<UUID, Long> bySocietyId() {
        return toMap(properties.countLiveBySocietyId(PropertyStatus.APPROVED), k -> (UUID) k);
    }

    /**
     * Live-listing count per city, keyed by <strong>lower-cased</strong> city name.
     *
     * <p>{@code properties.city} is free text and {@code cities.name} is curated, so "Pune" and
     * "pune" have to meet somewhere; the query lower-cases on its side and callers lower-case theirs.
     */
    @Transactional(readOnly = true)
    public Map<String, Long> byCity() {
        return toMap(properties.countLiveByCity(PropertyStatus.APPROVED), k -> (String) k);
    }

    /**
     * Live-listing count for one locality.
     *
     * <p>The map accessors above are right for a list endpoint and wrong for a detail one: a detail
     * read needs a single number, and building the whole lookup table to read one entry out of it
     * does work proportional to the catalogue instead of to the answer.
     */
    @Transactional(readOnly = true)
    public long forLocalitySlug(String slug) {
        return properties.countByLocalitySlugAndStatusAndArchivedFalse(slug, PropertyStatus.APPROVED);
    }

    /** Live-listing count for one society. See {@link #forLocalitySlug}. */
    @Transactional(readOnly = true)
    public long forSocietyId(UUID societyId) {
        return properties.countBySocietyIdAndStatusAndArchivedFalse(societyId, PropertyStatus.APPROVED);
    }

    /**
     * Turns the {@code [key, count]} rows of a grouped aggregate into a lookup table.
     *
     * <p>JPQL hands back {@code Object[]} for a multi-select; the cast is confined to this one
     * method so no caller ever sees an untyped array.
     */
    private static <K> Map<K, Long> toMap(
            Iterable<Object[]> rows, Function<Object, K> keyCast) {
        return java.util.stream.StreamSupport.stream(rows.spliterator(), false)
                .collect(Collectors.toMap(r -> keyCast.apply(r[0]), r -> (Long) r[1]));
    }
}
