package com.draazy.api.catalog.property;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Counts are computed because cached listing_count columns are not maintained. */
@Service
public class ListingCounts {

    private final PropertyRepository properties;

    public ListingCounts(PropertyRepository properties) {
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public Map<String, Long> byLocalitySlug() {
        return toMap(properties.countLiveByLocalitySlug(PropertyStatus.APPROVED), k -> (String) k);
    }

    @Transactional(readOnly = true)
    public Map<UUID, Long> bySocietyId() {
        return toMap(properties.countLiveBySocietyId(PropertyStatus.APPROVED), k -> (UUID) k);
    }

    /** City names are free text, so both query and callers lower-case before matching. */
    @Transactional(readOnly = true)
    public Map<String, Long> byCity() {
        return toMap(properties.countLiveByCity(PropertyStatus.APPROVED), k -> (String) k);
    }

    @Transactional(readOnly = true)
    public long forSocietyId(UUID societyId) {
        return properties.countBySocietyIdAndStatusAndArchivedFalse(societyId, PropertyStatus.APPROVED);
    }

    /** Lives here because "live" means approved and unarchived in the catalogue. */
    @Transactional(readOnly = true)
    public long forOwner(UUID ownerId) {
        return properties.countByOwnerIdAndStatusAndArchivedFalse(ownerId, PropertyStatus.APPROVED);
    }

    /** Whole-catalogue headline: three counts in one statement. */
    @Transactional(readOnly = true)
    public TrustStatsResponse trustStats() {
        TrustTally tally = properties.tallyTrust(PropertyStatus.APPROVED, Instant.now());
        return new TrustStatsResponse(
                tally.verifiedListings(), tally.totalListings(), tally.verifiedOwners());
    }

    /** Confine JPQL's {@code Object[]} casts here so callers never see untyped arrays. */
    private static <K> Map<K, Long> toMap(
            Iterable<Object[]> rows, Function<Object, K> keyCast) {
        return java.util.stream.StreamSupport.stream(rows.spliterator(), false)
                .collect(Collectors.toMap(r -> keyCast.apply(r[0]), r -> (Long) r[1]));
    }
}
