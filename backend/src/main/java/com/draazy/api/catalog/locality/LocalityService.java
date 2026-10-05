package com.draazy.api.catalog.locality;

import com.draazy.api.catalog.property.ListingCounts;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

    @Transactional(readOnly = true)
    public List<LocalityResponse> list() {
        Map<String, Long> counts = listingCounts.byLocalitySlug();
        return localities.findByActiveTrueOrderByNameAsc().stream()
                .map(locality -> localityMapper.toResponse(
                        locality, counts.getOrDefault(locality.getSlug(), 0L)))
                .toList();
    }
}
