package com.draazy.api.catalog.locality;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AuthPrincipal;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Queues listings the resolver could not place, because approval must not leave them unfiled. */
@Service
public class LocalityQueueService {

    /** Closed/rejected listings affect no visitor surface; flagged ones may return to approval. */
    private static final Set<String> QUEUED =
            Set.of(PropertyStatus.PENDING, PropertyStatus.APPROVED, PropertyStatus.FLAGGED);

    /** Cap the page for bad days; {@link LocalityQueueResponse#total} keeps the true count visible. */
    private static final int CAP = 200;

    private final PropertyRepository properties;
    private final LocalityRepository localities;
    private final AuditService audit;

    public LocalityQueueService(PropertyRepository properties, LocalityRepository localities,
            AuditService audit) {
        this.properties = properties;
        this.localities = localities;
        this.audit = audit;
    }

    /** Approved unfiled listings fail buyers now, so they sort ahead of pending rows. */
    @Transactional(readOnly = true)
    public LocalityQueueResponse queue() {
        List<LocalityQueueEntry> rows = properties
                .findAwaitingLocality(QUEUED, PageRequest.of(0, CAP)).stream()
                .map(LocalityQueueService::toEntry)
                .sorted(Comparator
                        .comparingInt((LocalityQueueEntry e) ->
                                PropertyStatus.APPROVED.equals(e.status()) ? 0 : 1)
                        .thenComparing(LocalityQueueEntry::createdAt))
                .toList();
        return new LocalityQueueResponse(properties.countAwaitingLocality(QUEUED), rows);
    }

    /** Retired areas are refused because filing under one keeps the listing invisible. */
    @Transactional
    public LocalityQueueEntry assign(AuthPrincipal caller, String propertyId, String slug) {
        Property property = Ids.parseUuid(propertyId)
                .flatMap(properties::findById)
                .or(() -> properties.findBySlug(propertyId))
                .orElseThrow(() -> NotFoundException.of("Property"));

        if (property.getLocalitySlug() != null) {
            throw new ConflictException("That listing already has a locality ('"
                    + property.getLocalitySlug() + "'). Edit the listing to change it.");
        }
        Locality locality = localities.findById(slug)
                .orElseThrow(() -> NotFoundException.of("Locality"));
        if (!locality.isActive()) {
            throw new ConflictException("'" + locality.getName() + "' is retired, so a listing filed"
                    + " under it stays out of search and off its landing page. Reactivate it or"
                    + " pick another area.");
        }

        property.setLocalitySlug(locality.getSlug());
        audit.record(caller, "property.locality", "property", property.getId().toString(),
                "slug", locality.getSlug(), "typed", property.getLocality());
        return toEntry(property);
    }

    private static LocalityQueueEntry toEntry(Property p) {
        return new LocalityQueueEntry(p.getId().toString(), p.getTitle(), p.getLocality(),
                p.getCity(), p.getLat(), p.getLng(), p.getStatus(), p.getLocalitySlug(),
                p.getCreatedAt());
    }
}
