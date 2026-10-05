package com.draazy.api.catalog.listing;

import static com.draazy.api.common.PlatformTime.IST;

import com.draazy.api.catalog.property.AddressKey;
import com.draazy.api.catalog.property.MeterKey;
import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyPhotoHash;
import com.draazy.api.catalog.property.PropertyPhotoHashRepository;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.trust.ListingCaseNotes;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Duplicate signals change independently from listing writes, so they own their service and columns. */
@Service
public class ListingDuplicateProbe {

    private static final List<String> OCCUPYING = PropertyStatus.OCCUPYING_DUPLICATE_STATUSES;

    /** Photo band hits are candidates, not findings; two chance collisions must not hide the real one. */
    private static final int PHOTO_CANDIDATE_CAP = 200;

    private final PropertyRepository properties;
    private final PropertyPhotoHashRepository photoHashes;
    private final ListingCaseNotes caseNotes;

    public ListingDuplicateProbe(PropertyRepository properties,
            PropertyPhotoHashRepository photoHashes, ListingCaseNotes caseNotes) {
        this.properties = properties;
        this.photoHashes = photoHashes;
        this.caseNotes = caseNotes;
    }

    /** Reindex every write because city/locality changes alter what the address text means. */
    public void reindex(Property p) {
        p.setAddressKey(AddressKey.of(p.getAddress(), p.getCity(), p.getLocality()));
        p.setElectricityMeterKey(MeterKey.of(p.getElectricityMeterNo()));
    }

    /** A typed {@code List} cannot collide on {@code |} inside a value, unlike a joined string.
     * It also keeps {@code 2} and {@code 2.0} distinct if numeric signals are added. */
    public List<Object> signalOf(Property p) {
        return Arrays.asList(p.getElectricityMeterKey(), p.getAddressKey(), p.getLocalitySlug());
    }

    /** {@code MANDATORY}: the finding must commit with the listing write that provoked it. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void flag(Property p) {
        flagSameDoorway(p);
        flagSamePhotos(p);
    }

    /** Photo hashes come from the request body; absent hashes on PATCH must not clear stored ones. */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean reindexPhotos(Property p, List<String> hexes) {
        if (hexes == null) {
            return false;
        }
        Set<Long> parsed = new LinkedHashSet<>();
        for (String hex : hexes) {
            Long h = PhotoHash.parse(hex);
            if (h != null) {
                parsed.add(h);
            }
            if (parsed.size() >= PhotoHash.MAX_PER_LISTING) {
                break;
            }
        }
        Set<Long> stored = photoHashes.findByPropertyId(p.getId()).stream()
                .map(PropertyPhotoHash::getHash).collect(Collectors.toSet());
        if (stored.equals(parsed)) {
            return false;
        }
        photoHashes.deleteByPropertyId(p.getId());

        // Flush deletes first; kept photos reuse primary keys and Hibernate inserts before deletes.
        photoHashes.flush();
        List<PropertyPhotoHash> rows = new ArrayList<>();
        for (Long h : parsed) {
            rows.add(new PropertyPhotoHash(p.getId(), h));
        }
        photoHashes.saveAll(rows);
        return true;
    }

    private void flagSameDoorway(Property p) {

        // With both keys null the query is provably empty and neither partial index is usable.
        if (p.getElectricityMeterKey() == null && p.getAddressKey() == null) {
            return;
        }
        List<Property> hits = properties.findDuplicateCandidates(
                p.getOwner().getId(), OCCUPYING,
                p.getElectricityMeterKey(), p.getAddressKey(), p.getLocalitySlug(),

                PageRequest.of(0, 2));
        if (hits.isEmpty()) {
            return;
        }

        // Sorting stabilizes the note body without adding ORDER BY to the index-friendly query.
        String others = hits.stream().map(ListingDuplicateProbe::describe).sorted()
                .collect(Collectors.joining("; "));
        caseNotes.postInternalOnce(p.getId(), p.getDeal(),
                "Possible duplicate. This listing (" + describe(p) + ") matches an active listing by"
                        + " another owner: " + others + ". " + nextStep(p));
    }

    /** Reused photos catch relisted flats when address and meter comparisons cannot. */
    private void flagSamePhotos(Property p) {
        List<PropertyPhotoHash> mine = photoHashes.findByPropertyId(p.getId());
        if (mine.isEmpty()) {
            return;
        }
        Set<Integer> bands0 = new LinkedHashSet<>();
        Set<Integer> bands1 = new LinkedHashSet<>();
        Set<Integer> bands2 = new LinkedHashSet<>();
        Set<Integer> bands3 = new LinkedHashSet<>();
        for (PropertyPhotoHash h : mine) {
            int[] b = PhotoHash.bands(h.getHash());
            bands0.add(b[0]);
            bands1.add(b[1]);
            bands2.add(b[2]);
            bands3.add(b[3]);
        }
        List<PropertyPhotoHash> candidates = photoHashes.findBandCandidates(
                p.getOwner().getId(), OCCUPYING, bands0, bands1, bands2, bands3,
                PageRequest.of(0, PHOTO_CANDIDATE_CAP));
        Set<UUID> matched = new LinkedHashSet<>();
        for (PropertyPhotoHash c : candidates) {
            for (PropertyPhotoHash m : mine) {
                if (PhotoHash.sameShot(m.getHash(), c.getHash())) {
                    matched.add(c.getPropertyId());
                    break;
                }
            }
        }
        if (matched.isEmpty()) {
            return;
        }

        // Stable ordering prevents postInternalOnce from filing the same finding on every edit.
        String others = properties.findAllById(matched).stream()
                .map(ListingDuplicateProbe::describe).sorted().limit(2)
                .collect(Collectors.joining("; "));
        caseNotes.postInternalOnce(p.getId(), p.getDeal(),
                "Possible duplicate. This listing (" + describe(p) + ") reuses photographs from an"
                        + " active listing by another owner: " + others + "."
                        + " Photographs are a weaker signal than an address — the same lobby or"
                        + " amenity shot can honestly appear on two listings. " + nextStep(p));
    }

    /** Age and owner verification help moderators tell a collision from a hijack. */
    private static String describe(Property p) {
        String ref = p.getSlug() == null ? p.getId().toString() : p.getSlug();
        return ref + " [" + p.getStatus()
                + (p.isOwnerVerified() ? ", owner verified" : ", owner unverified")
                + (p.getCreatedAt() == null ? ""

                        // Pune desk reads this; UTC would date 3am local listings to the previous day.
                        : ", listed " + p.getCreatedAt().atZone(IST).toLocalDate())
                + "]";
    }

    /** Live listings need a stay-up-or-pull-down decision; there is no approval step left. */
    private static String nextStep(Property p) {
        return PropertyStatus.PENDING.equals(p.getStatus())
                ? "Confirm who holds the mandate before approving."
                : "This listing is already live — it moved onto this address by edit. Decide whether"
                        + " it should stay up.";
    }

    /** Resweep closes the READ COMMITTED race where simultaneous submissions miss each other. */
    @Transactional
    public int resweepRecent(Instant since, int limit) {
        List<Property> recent =
                properties.findRecentSignalCarrying(since, OCCUPYING, PageRequest.of(0, limit));
        recent.forEach(this::flag);
        return recent.size();
    }

    /** Owners only see their own rows here, so the duplicate rule discloses nothing new. */
    @Transactional(readOnly = true)
    public ListingDuplicateVerdict ownDuplicate(UUID ownerId, String meter,
            String addressKey, String localitySlug) {

        // Same short-circuit as flag(): null keys make the query empty and unindexed.
        if (meter == null && addressKey == null) {
            return ListingDuplicateVerdict.NONE;
        }

        // One row is the whole answer. The caller is deciding whether to stop a submission, not
        // describing a collision, so a second hit would change nothing it does.
        List<Property> hits = properties.findOwnDuplicateCandidates(
                ownerId, OCCUPYING, meter, addressKey, localitySlug, PageRequest.of(0, 1));
        if (hits.isEmpty()) {
            return ListingDuplicateVerdict.NONE;
        }
        Property hit = hits.get(0);
        return new ListingDuplicateVerdict(true, hit.getId().toString());
    }
}
