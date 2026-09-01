package com.punenest.api.catalog.locality;

import com.punenest.api.catalog.property.ListingCounts;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.security.AuthPrincipal;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Curation of the locality reference table — the server behind the back-office localities console.
 *
 * <p>Separate from {@link LocalityService} rather than three more methods on it, and the split is
 * the same one {@code PropertyModerationService} draws against {@code PropertyService}: that class
 * answers "what does a visitor see", this one answers "what does an operator change". They have
 * different audiences, different guards and, most importantly, different definitions of the row set
 * — every read there is {@code active = true}, every read here is deliberately not.
 *
 * <p><strong>Nothing here deletes.</strong> {@code properties.locality_slug} and
 * {@code societies.locality_slug} are foreign keys onto this table, so a hard delete is either a
 * constraint violation or a cascade that takes live listings with it. Retirement is
 * {@code active = false}, which drops the locality out of search facets and 404s its landing page
 * while leaving the listings that reference it intact and individually addressable.
 */
@Service
public class LocalityAdminService {

    private final LocalityRepository localities;
    private final ListingCounts listingCounts;
    private final LocalityMapper localityMapper;
    private final AuditService audit;

    public LocalityAdminService(LocalityRepository localities, ListingCounts listingCounts,
            LocalityMapper localityMapper, AuditService audit) {
        this.localities = localities;
        this.listingCounts = listingCounts;
        this.localityMapper = localityMapper;
        this.audit = audit;
    }

    /**
     * Every locality, retired ones included, alphabetical, each with its true live-listing count.
     *
     * <p>Unpaged, matching the public list and for the same reason: this is a curated table of
     * city-level areas measured in tens of rows. The count matters more here than on the public
     * list — it is the number that tells a curator whether retiring an area would strand listings.
     */
    @Transactional(readOnly = true)
    public List<LocalityResponse> list() {
        Map<String, Long> counts = listingCounts.byLocalitySlug();
        return localities.findAllByOrderByNameAsc().stream()
                .map(locality -> localityMapper.toResponse(
                        locality, counts.getOrDefault(locality.getSlug(), 0L)))
                .toList();
    }

    /**
     * Add a locality.
     *
     * <p>The slug is the caller's if they sent one and {@link LocalityResolver#slugify} of the name
     * otherwise — the same function the resolver runs on the free text owners type, which is what
     * makes a locality created here resolvable the moment it exists rather than after somebody
     * notices the two disagree.
     *
     * @throws ConflictException if that slug is already curated, retired ones included
     */
    @Transactional
    public LocalityResponse create(AuthPrincipal caller, LocalityCreateRequest body) {
        String slug = body.slug() == null || body.slug().isBlank()
                ? LocalityResolver.slugify(body.name())
                : body.slug();
        if (slug == null || slug.isBlank()) {
            throw new ConflictException(
                    "That name does not reduce to a URL key. Send an explicit slug.");
        }
        // Retired localities count: the slug is still the primary key, and reusing it would silently
        // resurrect an area under a new name along with every listing that still points at it.
        if (localities.existsById(slug)) {
            throw new ConflictException("A locality with the key '" + slug + "' already exists.");
        }

        Locality locality = new Locality(slug, body.name().trim(), body.city().trim());
        apply(locality, body.avgRentPsf(), body.avgBuyPsf(), body.ratePerSqft(), body.avgRent(),
                body.demand(), body.focus(), body.lat(), body.lng());
        localities.save(locality);

        audit.record(caller, "locality.create", "locality", slug, "name", locality.getName());
        return localityMapper.toResponse(locality, 0L);
    }

    /**
     * Correct a locality in place. Sparse patch: {@code null} leaves a field alone.
     *
     * @throws NotFoundException if no locality has this slug
     */
    @Transactional
    public LocalityResponse update(AuthPrincipal caller, String slug, LocalityUpdateRequest body) {
        Locality locality = localities.findById(slug)
                .orElseThrow(() -> NotFoundException.of("Locality"));

        if (body.name() != null && !body.name().isBlank()) {
            locality.setName(body.name().trim());
        }
        if (body.city() != null && !body.city().isBlank()) {
            locality.setCity(body.city().trim());
        }
        apply(locality, body.avgRentPsf(), body.avgBuyPsf(), body.ratePerSqft(), body.avgRent(),
                body.demand(), body.focus(), body.lat(), body.lng());
        if (body.active() != null) {
            locality.setActive(body.active());
        }

        audit.record(caller, "locality.update", "locality", slug, "name", locality.getName());
        return localityMapper.toResponse(locality, listingCounts.forLocalitySlug(slug));
    }

    /**
     * Retire a locality — {@code active = false}, not a delete. Idempotent.
     *
     * <p>The listing count travels into the audit row rather than blocking the call. A curator
     * retiring an area with live listings in it is usually right (the area was a duplicate, or the
     * listings are about to be re-resolved), and refusing would leave them no way to finish; what
     * they must not be able to do is retire it and have nobody able to tell afterwards how many
     * listings went dark.
     *
     * @throws NotFoundException if no locality has this slug
     */
    @Transactional
    public LocalityResponse archive(AuthPrincipal caller, String slug) {
        Locality locality = localities.findById(slug)
                .orElseThrow(() -> NotFoundException.of("Locality"));
        long live = listingCounts.forLocalitySlug(slug);

        locality.setActive(false);

        audit.record(caller, "locality.archive", "locality", slug, "liveListings",
                String.valueOf(live));
        return localityMapper.toResponse(locality, live);
    }

    /**
     * The price and position fields, which create and update treat identically.
     *
     * <p>Shared because they are the fields where "sent" and "unset" are the same word on both
     * routes: a create that omits {@code demand} and a patch that omits it both mean "no opinion",
     * so there is exactly one place that decides what that does.
     */
    private void apply(Locality locality, java.math.BigDecimal avgRentPsf,
            java.math.BigDecimal avgBuyPsf, java.math.BigDecimal ratePerSqft, Long avgRent,
            Integer demand, String focus, Double lat, Double lng) {
        if (avgRentPsf != null) {
            locality.setAvgRentPsf(avgRentPsf);
        }
        if (avgBuyPsf != null) {
            locality.setAvgBuyPsf(avgBuyPsf);
        }
        if (ratePerSqft != null) {
            locality.setRatePerSqft(ratePerSqft);
        }
        if (avgRent != null) {
            locality.setAvgRent(avgRent);
        }
        if (demand != null) {
            locality.setDemand(demand);
        }
        if (focus != null && !focus.isBlank()) {
            locality.setFocus(focus);
        }
        if (lat != null) {
            locality.setLat(lat);
        }
        if (lng != null) {
            locality.setLng(lng);
        }
    }
}
