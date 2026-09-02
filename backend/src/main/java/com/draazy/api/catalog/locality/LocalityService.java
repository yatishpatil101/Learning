package com.draazy.api.catalog.locality;

import com.draazy.api.catalog.property.ListingCounts;
import com.draazy.api.common.error.NotFoundException;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Reads the curated locality reference data for the public catalogue. */
@Service
public class LocalityService {

    private final LocalityRepository localities;
    private final ListingCounts listingCounts;
    private final LocalityMapper localityMapper;

    public LocalityService(LocalityRepository localities, ListingCounts listingCounts,
            LocalityMapper localityMapper) {
        this.localities = localities;
        this.listingCounts = listingCounts;
        this.localityMapper = localityMapper;
    }

    /**
     * Every active locality, alphabetical, each with its true live-listing count.
     *
     * <p>Two queries whatever the row count: the list, and one grouped aggregate. Asking for a count
     * per locality would be an N+1 on an endpoint anyone can call without a token.
     */
    @Transactional(readOnly = true)
    public List<LocalityResponse> list() {
        Map<String, Long> counts = listingCounts.byLocalitySlug();
        return localities.findByActiveTrueOrderByNameAsc().stream()
                .map(locality -> localityMapper.toResponse(
                        locality, counts.getOrDefault(locality.getSlug(), 0L)))
                .toList();
    }

    /**
     * One locality by slug, with its narrative fields.
     *
     * <p>An inactive locality answers 404 rather than being served: it has been retired from the
     * site, and a retired page that still renders is a page search engines keep indexing.
     *
     * @throws NotFoundException if no active locality has this slug
     */
    @Transactional(readOnly = true)
    public LocalityDetailResponse get(String slug) {
        Locality locality = localities.findBySlugAndActiveTrue(slug)
                .orElseThrow(() -> NotFoundException.of("Locality"));
        return localityMapper.toDetail(locality, listingCounts.forLocalitySlug(slug));
    }
}
