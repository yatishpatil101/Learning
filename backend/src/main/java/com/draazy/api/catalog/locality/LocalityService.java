package com.draazy.api.catalog.locality;

import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.error.NotFoundException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LocalityService {

    private final LocalityRepository localities;
    private final PropertyRepository properties;
    private final LocalityMapper localityMapper;

    public LocalityService(LocalityRepository localities, PropertyRepository properties,
            LocalityMapper localityMapper) {
        this.localities = localities;
        this.properties = properties;
        this.localityMapper = localityMapper;
    }

    @Transactional(readOnly = true)
    public List<LocalityResponse> list() {
        Map<String, LocalityStats> stats = statsBySlug(null);
        return localities.findDirectory(PropertyStatus.APPROVED).stream()
                .map(l -> localityMapper.toResponse(l, stats.getOrDefault(l.getSlug(), LocalityStats.NONE)))
                .toList();
    }

    /** Non-live localities still resolve: their page renders, and indexability follows the live count. */
    @Transactional(readOnly = true)
    public LocalityResponse get(String slug) {
        Locality locality = localities.findById(slug).orElseThrow(() -> NotFoundException.of("Locality"));
        return localityMapper.toResponse(locality,
                statsBySlug(slug).getOrDefault(slug, LocalityStats.NONE));
    }

    /** Asking sale rate per sq ft from live listings; empty below three samples. */
    @Transactional(readOnly = true)
    public Optional<Long> marketRate(String slug) {
        return Optional.ofNullable(statsBySlug(slug).getOrDefault(slug, LocalityStats.NONE).ratePerSqft());
    }

    private Map<String, LocalityStats> statsBySlug(String slug) {
        Map<String, LocalityStats> out = new HashMap<>();
        for (Object[] row : properties.liveLocalityStats(PropertyStatus.APPROVED, slug)) {
            out.put((String) row[0], LocalityStats.of(row));
        }
        return out;
    }
}
