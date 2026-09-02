package com.draazy.api.moderation.duplicate;

import com.draazy.api.catalog.listing.ListingArchiveService;
import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.catalog.property.PropertyPhotoHash;
import com.draazy.api.catalog.property.PropertyPhotoHashRepository;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyResponse;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.trust.BackOfficeVisibility;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.OutreachCounts;
import com.draazy.api.common.trust.PrivateFieldVisibility;
import com.draazy.api.security.AuthPrincipal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The ops desk's duplicate clustering — derived on demand, never stored (D255).
 *
 * <p><strong>Why this exists as a third reading of "the same doorway".</strong>
 * {@code ListingDuplicateProbe} already answers a duplicate question, and its javadoc is explicit
 * about the danger of a second answer drifting from it: "two readings of one rule about what counts
 * as the same doorway; if they ever disagree, the platform blocks owners on a definition it does not
 * flag strangers on." So a third reading needs its own justification rather than an apology.
 *
 * <p>The justification is that the three readings answer three different questions, and only one of
 * them is about a pair of listings:
 * <ul>
 *   <li>{@code findOwnDuplicateCandidates} — "have I already posted this?", asked of an owner in the
 *       wizard, so necessarily scoped to that owner.</li>
 *   <li>{@code findDuplicateCandidates} — "is this stranger's listing already on the platform?",
 *       asked at write time, so scoped away from the owner: a person colliding with themselves is
 *       not the abuse the probe exists to catch, and flagging it would file a moderation note about
 *       an owner's own housekeeping.</li>
 *   <li>this — "what does the catalogue currently contain that looks duplicated?", asked by a human
 *       looking at the whole catalogue rather than at one write.</li>
 * </ul>
 *
 * <p><strong>This one includes same-owner clusters, and that is the deliberate divergence.</strong>
 * The write-time probe excludes them because a note on an owner's file saying "you have posted this
 * twice" is noise at the moment of writing. But the same fact seen from the desk is a real supply
 * problem — one flat occupying two slots in search results is the same distortion whether it came
 * from one account or two, and a broker double-posting under a single login is a pattern the
 * cross-owner rule cannot see by construction. So the desk sees them and
 * {@link DuplicateCluster#sameOwner} says so on the card, because the operator's response differs:
 * a stranger collision is a moderation case, an owner colliding with themselves is usually a phone
 * call. Filtering them out here would have hidden the second case entirely; showing them unlabelled
 * would have invited the first response to the second situation.
 *
 * <p><strong>The signal definitions are not re-derived here.</strong> The doorway arm reads the same
 * {@code electricityMeterKey} and {@code addressKey}/{@code localitySlug} columns the probe indexes,
 * and the photo arm bands and verifies with {@link PhotoHash} exactly as the probe does. What is new
 * is only the shape of the answer: components rather than pairs.
 *
 * <p><strong>Nothing here blocks or hides anything.</strong> Like the probe, this reports a
 * suspicion. Listings in a cluster stay live and stay searchable; the only writes are the two an
 * operator asks for explicitly.
 */
@Service
public class ListingDuplicateClusterService {

    /**
     * The statuses that occupy a slot in search.
     *
     * <p>Identical to {@code ListingDuplicateProbe.OCCUPYING}, and identical for the same reason: a
     * rejected or archived listing is not competing for a seeker's attention, so it is not a
     * duplicate of anything in the sense this desk cares about.
     */
    private static final List<String> OCCUPYING =
            List.of(PropertyStatus.PENDING, PropertyStatus.APPROVED);

    /**
     * How many signal-carrying listings one request will cluster.
     *
     * <p>Generous rather than tight, because the cost of binding is not a slow page — it is a pair
     * split across the boundary and therefore invisible. The read is O(n) in signal-carrying
     * listings plus the band buckets, both of which are small multiples of the catalogue, so this
     * ceiling exists to stop a pathological catalogue from hanging the desk rather than to keep a
     * normal one fast. When it does bind, {@link DuplicateClusterReport#truncated} says so.
     */
    static final int SCAN_CAP = 2000;

    /**
     * How many photos sharing one 16-bit band are worth comparing.
     *
     * <p>Mirrors {@code ListingDuplicateProbe.PHOTO_CANDIDATE_CAP}, deliberately the same number.
     * A band shared by more than this many photographs is not evidence of anything — it is a plain
     * wall, a floor plan template, or the builder's own render, and the pairs it would generate are
     * noise that would bury the real ones. Capping here rather than filtering afterwards keeps the
     * comparison count linear in the bucket instead of quadratic.
     */
    private static final int BAND_BUCKET_CAP = 200;

    private final PropertyRepository properties;
    private final PropertyPhotoHashRepository photoHashes;
    private final ListingDuplicateDismissalRepository dismissals;
    private final ListingArchiveService archiveService;
    private final PropertyMapper propertyMapper;
    private final AuditService audit;

    public ListingDuplicateClusterService(PropertyRepository properties,
            PropertyPhotoHashRepository photoHashes,
            ListingDuplicateDismissalRepository dismissals,
            ListingArchiveService archiveService,
            PropertyMapper propertyMapper,
            AuditService audit) {
        this.properties = properties;
        this.photoHashes = photoHashes;
        this.dismissals = dismissals;
        this.archiveService = archiveService;
        this.propertyMapper = propertyMapper;
        this.audit = audit;
    }

    /** Every unsettled cluster in the catalogue right now. */
    @Transactional(readOnly = true)
    public DuplicateClusterReport clusters() {
        // One row past the ceiling, so a full page is distinguishable from a page that happens to
        // be exactly the ceiling. Without the extra row the two are identical and the report would
        // have to guess.
        List<Property> scan = properties.findSignalCarrying(OCCUPYING, PageRequest.of(0, SCAN_CAP + 1));
        boolean truncated = scan.size() > SCAN_CAP;
        List<Property> candidates = truncated ? List.copyOf(scan.subList(0, SCAN_CAP)) : scan;

        List<Link> links = new ArrayList<>();
        linkByDoorway(candidates, links);
        linkByPhotos(candidates, links);

        DisjointSet components = new DisjointSet();
        for (Link link : links) {
            components.union(link.a(), link.b());
        }

        // Reasons are attributed after every union, keyed on the settled root. Doing it during the
        // pass would key some sets on a root that later becomes a child of another cluster, and
        // those reasons would be orphaned -- a cluster rendering with a blank reason for no reason
        // the operator could see.
        Map<UUID, Set<String>> reasons = new HashMap<>();
        for (Link link : links) {
            reasons.computeIfAbsent(components.find(link.a()), k -> new TreeSet<>()).add(link.reason());
        }

        Map<UUID, List<Property>> grouped = new HashMap<>();
        for (Property p : candidates) {
            UUID root = components.find(p.getId());
            grouped.computeIfAbsent(root, k -> new ArrayList<>()).add(p);
        }

        List<Candidate> found = new ArrayList<>();
        for (Map.Entry<UUID, List<Property>> entry : grouped.entrySet()) {
            List<Property> members = entry.getValue();
            if (members.size() < 2) {
                continue;
            }
            members.sort(Comparator.comparing(Property::getCreatedAt).reversed());
            List<UUID> ids = members.stream().map(Property::getId).toList();
            String reason = String.join("+", reasons.getOrDefault(entry.getKey(), Set.of()));
            found.add(new Candidate(DuplicateClusterSignature.of(ids), reason, members));
        }

        // One round trip for every signature on the page. Asking per cluster would make the query
        // count grow with the backlog, which is exactly when the desk is already slowest.
        Set<String> settled = found.isEmpty() ? Set.of()
                : dismissals.findByClusterSignatureIn(found.stream().map(Candidate::signature).toList())
                        .stream().map(ListingDuplicateDismissal::getClusterSignature)
                        .collect(java.util.stream.Collectors.toSet());

        List<DuplicateCluster> clusters = found.stream()
                .filter(c -> !settled.contains(c.signature()))
                .sorted(Comparator.comparing(
                        (Candidate c) -> c.members().get(0).getCreatedAt()).reversed())
                .map(this::render)
                .toList();

        return new DuplicateClusterReport(clusters, candidates.size(), truncated);
    }

    /**
     * Keep one listing, archive the rest of the cluster.
     *
     * <p>Archive rather than delete, and through {@link ListingArchiveService} rather than a bulk
     * status write, so a merge is the same reversible act as any other takedown: the losing listings
     * keep their history, their enquiries and their restore path. An operator who merges the wrong
     * pair undoes it from the archive.
     *
     * <p>The kept listing is deliberately not touched. There is no "this is the canonical one" flag
     * to set — the prototype wrote {@code duplicateFlag} and {@code duplicateOf} here, two fields no
     * table on this platform has ever had, which is why the merge silently did nothing against a
     * real server.
     */
    @Transactional
    public void resolve(AuthPrincipal actor, String keepId, List<String> dropIds) {
        if (keepId == null || keepId.isBlank()) {
            throw new BadRequestException("Name the listing to keep");
        }
        List<String> drops = dropIds == null ? List.of() : dropIds.stream()
                .filter(id -> id != null && !id.isBlank())
                .filter(id -> !id.equals(keepId))
                .distinct()
                .toList();
        if (drops.isEmpty()) {
            throw new BadRequestException("Name at least one listing to archive");
        }
        for (String dropId : drops) {
            archiveService.archive(actor, dropId, "Merged duplicate — kept " + keepId);
        }
        audit.record(actor, "property.duplicate.merge", "property", keepId,
                "archived", String.join(",", drops),
                "count", drops.size());
    }

    /**
     * Record that a cluster is a coincidence.
     *
     * <p>The signature is derived here from the ids the caller sent, never accepted from the caller.
     * A client that computed its own would be a second implementation of
     * {@link DuplicateClusterSignature}, and a client that sent a signature not matching its ids
     * could settle a set nobody looked at.
     */
    @Transactional
    public void dismiss(AuthPrincipal actor, List<String> memberIds) {
        List<UUID> ids = parseIds(memberIds);
        if (ids.size() < 2) {
            throw new BadRequestException("A cluster is at least two listings");
        }
        String signature = DuplicateClusterSignature.of(ids);
        // Idempotent: a double-clicked button and two operators reaching the same verdict are the
        // same fact, and the unique index would otherwise turn the second into a 500.
        if (dismissals.findByClusterSignature(signature).isPresent()) {
            return;
        }
        dismissals.save(new ListingDuplicateDismissal(
                signature, DuplicateClusterSignature.canonicalMembers(ids), actor.userId()));
        audit.record(actor, "property.duplicate.dismiss", "property",
                DuplicateClusterSignature.canonicalMembers(ids).get(0),
                "cluster", signature,
                "members", String.join(",", DuplicateClusterSignature.canonicalMembers(ids)));
    }

    private DuplicateCluster render(Candidate c) {
        List<PropertyResponse> listings = c.members().stream()
                // REVEALED for the same reason the moderation queue reveals: this desk exists to
                // ring an owner about a listing, and a masked number sends the operator to look it
                // up somewhere the platform cannot see -- trading an audited disclosure for an
                // unaudited one. OutreachCounts.NONE because the tab renders identity, not contact
                // history, and a per-listing count would be a round trip nothing displays.
                .map(p -> propertyMapper.toResponse(p, ContactVisibility.REVEALED,
                        BackOfficeVisibility.VISIBLE, OutreachCounts.NONE,
                        PrivateFieldVisibility.VISIBLE))
                .toList();
        boolean sameOwner = c.members().stream()
                .map(p -> p.getOwner() == null ? null : p.getOwner().getId())
                .distinct()
                .count() == 1;
        return new DuplicateCluster(c.signature(), c.reason(), sameOwner, listings);
    }

    /**
     * The doorway arm: a shared electricity meter, or a shared address key within one locality.
     *
     * <p>Bucketed rather than compared pairwise. Every listing in a bucket is by definition linked
     * to every other, so linking each to the bucket's first member produces the same component at
     * linear cost instead of quadratic.
     *
     * <p>The address bucket key is a typed pair, not a joined string. That is the same care
     * {@code ListingDuplicateProbe.signalOf} takes and for the same reason: a separator character
     * occurring inside one of the values would make two different doorways compare equal, and the
     * resulting false cluster would be indistinguishable from a real one.
     */
    private void linkByDoorway(List<Property> candidates, List<Link> links) {
        Map<String, List<Property>> byMeter = new HashMap<>();
        Map<DoorwayKey, List<Property>> byAddress = new HashMap<>();
        for (Property p : candidates) {
            String meter = p.getElectricityMeterKey();
            if (meter != null && !meter.isBlank()) {
                byMeter.computeIfAbsent(meter, k -> new ArrayList<>()).add(p);
            }
            String address = p.getAddressKey();
            String locality = p.getLocalitySlug();
            if (address != null && !address.isBlank() && locality != null && !locality.isBlank()) {
                byAddress.computeIfAbsent(new DoorwayKey(address, locality), k -> new ArrayList<>())
                        .add(p);
            }
        }
        for (List<Property> bucket : byMeter.values()) {
            linkBucket(bucket, DuplicateCluster.REASON_ADDRESS, links);
        }
        for (List<Property> bucket : byAddress.values()) {
            linkBucket(bucket, DuplicateCluster.REASON_ADDRESS, links);
        }
    }

    private void linkBucket(List<Property> bucket, String reason, List<Link> links) {
        for (int i = 1; i < bucket.size(); i++) {
            links.add(new Link(bucket.get(0).getId(), bucket.get(i).getId(), reason));
        }
    }

    /**
     * The photo arm: band-index to find candidates, {@link PhotoHash#sameShot} to confirm them.
     *
     * <p>Exactly the probe's two-step, applied symmetrically instead of from one listing outward.
     * The band lookup is fast and approximate; {@code sameShot} is exact and would be a scan. Doing
     * only the first would cluster listings that merely share a 16-bit slice of a hash.
     */
    private void linkByPhotos(List<Property> candidates, List<Link> links) {
        List<UUID> ids = candidates.stream().map(Property::getId).toList();
        if (ids.isEmpty()) {
            return;
        }
        List<PropertyPhotoHash> all = photoHashes.findByPropertyIdIn(ids);
        Map<BandKey, List<PropertyPhotoHash>> index = new HashMap<>();
        for (PropertyPhotoHash h : all) {
            int[] bands = PhotoHash.bands(h.getHash());
            for (int i = 0; i < bands.length; i++) {
                index.computeIfAbsent(new BandKey(i, bands[i]), k -> new ArrayList<>()).add(h);
            }
        }
        Set<Long> seen = new HashSet<>();
        for (List<PropertyPhotoHash> bucket : index.values()) {
            if (bucket.size() < 2 || bucket.size() > BAND_BUCKET_CAP) {
                continue;
            }
            for (int i = 0; i < bucket.size(); i++) {
                for (int j = i + 1; j < bucket.size(); j++) {
                    PropertyPhotoHash a = bucket.get(i);
                    PropertyPhotoHash b = bucket.get(j);
                    if (a.getPropertyId().equals(b.getPropertyId())) {
                        continue;
                    }
                    // A pair sharing several bands appears in several buckets. Verifying it once is
                    // not just cheaper -- it keeps `links` from carrying the same edge repeatedly,
                    // which would make the reason attribution loop do redundant finds.
                    if (!seen.add(pairKey(a, b))) {
                        continue;
                    }
                    if (PhotoHash.sameShot(a.getHash(), b.getHash())) {
                        links.add(new Link(a.getPropertyId(), b.getPropertyId(),
                                DuplicateCluster.REASON_IMAGE));
                    }
                }
            }
        }
    }

    private static long pairKey(PropertyPhotoHash a, PropertyPhotoHash b) {
        long x = a.getHash();
        long y = b.getHash();
        return x < y ? x * 31 + y : y * 31 + x;
    }

    private List<UUID> parseIds(List<String> raw) {
        if (raw == null) {
            return List.of();
        }
        Set<UUID> ids = new LinkedHashSet<>();
        for (String value : raw) {
            if (value == null || value.isBlank()) {
                continue;
            }
            try {
                ids.add(UUID.fromString(value.trim()));
            } catch (IllegalArgumentException e) {
                throw new BadRequestException("Not a listing id: " + value);
            }
        }
        return List.copyOf(ids);
    }

    /** A pair of listings and why they were linked. */
    private record Link(UUID a, UUID b, String reason) {
    }

    /** A typed bucket key — see {@link #linkByDoorway} for why this is not a joined string. */
    private record DoorwayKey(String addressKey, String localitySlug) {
    }

    /** Which of the four bands, and its value. */
    private record BandKey(int index, int value) {
    }

    /** A cluster before rendering, so the dismissal filter can run on signatures alone. */
    private record Candidate(String signature, String reason, List<Property> members) {
    }

    /**
     * Union-find with path compression.
     *
     * <p>Union by nothing in particular — no rank, no size. The sets here are tiny (a cluster of
     * more than a handful of listings is already an anomaly worth looking at by hand), so the
     * balancing that makes union-find asymptotically interesting would be code with no measurable
     * effect on any catalogue this platform will have.
     */
    private static final class DisjointSet {

        private final Map<UUID, UUID> parent = new HashMap<>();

        UUID find(UUID x) {
            UUID root = parent.getOrDefault(x, x);
            if (root.equals(x)) {
                return x;
            }
            UUID settled = find(root);
            parent.put(x, settled);
            return settled;
        }

        void union(UUID a, UUID b) {
            UUID rootA = find(a);
            UUID rootB = find(b);
            if (!rootA.equals(rootB)) {
                parent.put(rootA, rootB);
            }
        }
    }
}
