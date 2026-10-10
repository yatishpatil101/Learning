package com.draazy.api.catalog.locality;

import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
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
    private final AuditService audit;

    public LocalityService(LocalityRepository localities, PropertyRepository properties,
            LocalityMapper localityMapper, AuditService audit) {
        this.localities = localities;
        this.properties = properties;
        this.localityMapper = localityMapper;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public List<LocalityResponse> list() {
        Map<String, LocalityStats> stats = statsBySlug(null);
        return localities.findDirectory(PropertyStatus.APPROVED).stream()
                .map(l -> localityMapper.toResponse(l, stats.getOrDefault(l.getSlug(), LocalityStats.NONE)))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<LocalityAdminRow> adminList() {
        Map<String, LocalityStats> stats = statsBySlug(null);
        return localities.findDirectory(PropertyStatus.APPROVED).stream()
                .map(l -> adminRow(l, stats.getOrDefault(l.getSlug(), LocalityStats.NONE)))
                .toList();
    }

    /** Retiring only closes the area to new listings: live listings and the area's page stay. */
    @Transactional
    public LocalityAdminRow retire(String slug, AuthPrincipal actor) {
        Locality locality = localities.findById(slug).orElseThrow(() -> NotFoundException.of("Locality"));
        LocalityStats stats = statsBySlug(slug).getOrDefault(slug, LocalityStats.NONE);
        if (!locality.isArchived()) {
            locality.retire(Instant.now());
            audit.record(actor, "locality.retire", "locality", slug, "liveListings", stats.live());
        }
        return adminRow(locality, stats);
    }

    @Transactional
    public LocalityAdminRow restore(String slug, AuthPrincipal actor) {
        Locality locality = localities.findById(slug).orElseThrow(() -> NotFoundException.of("Locality"));
        LocalityStats stats = statsBySlug(slug).getOrDefault(slug, LocalityStats.NONE);
        if (locality.isArchived()) {
            locality.restore();
            audit.record(actor, "locality.restore", "locality", slug, "liveListings", stats.live());
        }
        return adminRow(locality, stats);
    }

    private static LocalityAdminRow adminRow(Locality l, LocalityStats stats) {
        return new LocalityAdminRow(l.getSlug(), l.getName(), l.getLat(), l.getLng(), l.isArchived(), stats.live());
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
