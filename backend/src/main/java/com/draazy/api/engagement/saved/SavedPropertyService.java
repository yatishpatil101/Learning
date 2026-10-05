package com.draazy.api.engagement.saved;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertySummary;
import com.draazy.api.common.error.NotFoundException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Shortlists are user preferences, not auditable business records, and can grow unbounded. */
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

    /** The mapper produces the contract {@link PropertySummary} without ever leaking the JPA entity.
     * Saved-order is restored after {@code findAllById}, which does not guarantee it. */
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

    /** Validates existence first so we never write a dangling FK (which would 500 on the constraint). */
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
