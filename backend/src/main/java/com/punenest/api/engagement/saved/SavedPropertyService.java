package com.punenest.api.engagement.saved;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyMapper;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertySummary;
import com.punenest.api.common.error.NotFoundException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The authenticated user's property shortlist — a personal preference rather than a business
 * record, so saves and unsaves are preference toggles, not auditable state changes.
 *
 * <p><strong>Paged, though it was not always.</strong> This Javadoc used to argue the list was
 * "structurally bounded" because one user is the growth limit — but it named no structure, and
 * there is none: nothing caps how many listings a user may shortlist. The endpoint returned
 * {@code PropertySummary}, a 22-field object, once per save, forever. api-standards.md §5.1 permits
 * a bare array where growth is bounded <em>or</em> explicitly capped in the service; this was
 * neither, and "one user's clicks" is a rate, not a bound.
 */
@Service
public class SavedPropertyService {

    private final SavedPropertyRepository savedPropertyRepo;
    private final PropertyRepository propertyRepo;
    private final PropertyMapper propertyMapper;

    public SavedPropertyService(SavedPropertyRepository savedPropertyRepo,
            PropertyRepository propertyRepo, PropertyMapper propertyMapper) {
        this.savedPropertyRepo = savedPropertyRepo;
        this.propertyRepo = propertyRepo;
        this.propertyMapper = propertyMapper;
    }

    /**
     * The caller's saved listings as full card projections, newest-saved first, paged.
     *
     * <p>Two queries: a paged id list from the join table, then a batch fetch of that page's
     * entities. The mapper produces the contract {@link PropertySummary} without ever leaking the
     * JPA entity.
     *
     * <p>Saved-order is restored after {@code findAllById}, which does not guarantee it. Rows whose
     * property has since been hard-deleted drop out, which is why the returned content can be
     * shorter than the page size while {@code totalElements} still counts the join rows — the
     * alternative is a page with holes in it.
     */
    @Transactional(readOnly = true)
    public Page<PropertySummary> listSaved(UUID userId, Pageable pageable) {
        Page<UUID> ids = savedPropertyRepo.findSavedPropertyIds(userId, pageable);
        if (ids.isEmpty()) {
            return new PageImpl<>(List.of(), ids.getPageable(), ids.getTotalElements());
        }
        List<Property> props = propertyRepo.findAllById(ids.getContent());
        Map<UUID, Property> byId = new LinkedHashMap<>();
        props.forEach(p -> byId.put(p.getId(), p));
        List<PropertySummary> content = ids.getContent().stream()
                .filter(byId::containsKey)
                .map(id -> propertyMapper.toSummary(byId.get(id)))
                .toList();
        return new PageImpl<>(content, ids.getPageable(), ids.getTotalElements());
    }

    /**
     * Idempotently add a property to the caller's shortlist. Validates existence first so we
     * never write a dangling FK (which would 500 on the constraint).
     *
     * @throws NotFoundException if the property does not exist
     */
    @Transactional
    public void save(UUID userId, UUID propertyId) {
        if (!propertyRepo.existsById(propertyId)) {
            throw NotFoundException.of("Property");
        }
        savedPropertyRepo.insertIfAbsent(userId, propertyId);
    }

    /** Idempotently remove a property from the caller's shortlist. 204 whether or not a row existed. */
    @Transactional
    public void unsave(UUID userId, UUID propertyId) {
        savedPropertyRepo.deleteByUserAndProperty(userId, propertyId);
    }
}
