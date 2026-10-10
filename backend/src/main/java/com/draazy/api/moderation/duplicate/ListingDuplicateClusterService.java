package com.draazy.api.moderation.duplicate;

import com.draazy.api.catalog.listing.ListingArchiveService;
import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.catalog.property.PropertyPhotoHash;
import com.draazy.api.catalog.property.PropertyPhotoHashRepository;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.security.AuthPrincipal;
import java.math.BigDecimal;
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

// Derived on demand, never stored, because the signals change with live listing edits.
@Service
public class ListingDuplicateClusterService {

    private static final List<String> OCCUPYING = PropertyStatus.OCCUPYING_DUPLICATE_STATUSES;

    // Generous because the real failure is splitting a duplicate pair across the boundary.
    static final int SCAN_CAP = 2000;

    // Mirrors ListingDuplicateProbe.PHOTO_CANDIDATE_CAP so probe and desk agree.
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

    @Transactional(readOnly = true)
    public DuplicateClusterReport clusters() {

        // One row past the ceiling distinguishes an exact page from a truncated scan.
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

        // Attribute after union so reasons key on the settled root, not a later child.
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

    // Archive through ListingArchiveService so a merge is reversible like other takedowns.
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

    // Signature is derived from submitted ids, never accepted from the caller.
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
        List<DuplicateCluster.Listing> listings = c.members().stream()

                // Revealed so owner contact stays in the audited platform workflow.
                .map(p -> new DuplicateCluster.Listing(p.getId().toString(), p.getSlug(), p.getTitle(),
                        p.getPrice(), p.getStatus(), propertyMapper.coverImage(p), p.getLocality(),
                        p.getPincode(), p.isVerified(), p.getCreatedAt(),
                        propertyMapper.toOwner(p.getOwner(), ContactVisibility.REVEALED)))
                .toList();
        boolean sameOwner = c.members().stream()
                .map(p -> p.getOwner() == null ? null : p.getOwner().getId())
                .distinct()
                .count() == 1;
        return new DuplicateCluster(c.signature(), c.reason(), sameOwner, hintsFor(c.members()), listings);
    }

    private static List<DuplicateCluster.Hint> hintsFor(List<Property> members) {
        for (int i = 0; i < members.size(); i++) {
            for (int j = i + 1; j < members.size(); j++) {
                if (sameSocietyBhkArea(members.get(i), members.get(j))) {
                    return List.of(new DuplicateCluster.Hint("same_society_bhk_area", "soft",
                            "Same society, BHK and carpet area within 10%."));
                }
            }
        }
        return List.of();
    }

    private static boolean sameSocietyBhkArea(Property a, Property b) {
        if (a.getSocietyId() == null || !a.getSocietyId().equals(b.getSocietyId())) {
            return false;
        }
        if (a.getBhk() == null || b.getBhk() == null || a.getBhk().compareTo(b.getBhk()) != 0) {
            return false;
        }
        BigDecimal left = a.getCarpetArea();
        BigDecimal right = b.getCarpetArea();
        if (left == null || right == null || left.signum() <= 0 || right.signum() <= 0) {
            return false;
        }
        BigDecimal min = left.min(right);
        BigDecimal max = left.max(right);
        return max.subtract(min).multiply(BigDecimal.TEN).compareTo(max) <= 0;
    }

    // Bucketed rather than pairwise so the desk can scan the full candidate set.
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

    // Same two-step as the probe, applied symmetrically across all candidates.
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

                    // Same pair can share several bands; verify once to avoid duplicate edges.
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

    private record BandKey(int index, int value) {
    }

    /** A cluster before rendering, so the dismissal filter can run on signatures alone. */
    private record Candidate(String signature, String reason, List<Property> members) {
    }

    // Union-find with path compression. Union by nothing in particular — no rank, no size.
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
