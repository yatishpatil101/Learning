package com.punenest.api.catalog.managed;

import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Maps {@link ManagedProperty} entities to their wire {@link ManagedPropertyDto}. UUIDs render as
 * strings (the contract types every id as {@code string}); a null {@code publishedListingId} stays
 * null so the client can tell an unpublished record from a published one.
 */
@Component
public class ManagedPropertyMapper {

    public ManagedPropertyDto toDto(ManagedProperty m) {
        return new ManagedPropertyDto(
                m.getId().toString(),
                m.getTitle(),
                m.getDeal(),
                m.getPropertyType(),
                m.getBhk(),
                m.getPrice(),
                m.getLocality(),
                m.getLocalitySlug(),
                m.getSociety(),
                m.getArea(),
                m.getAreaUnit(),
                m.getFurnishing(),
                m.getVisibility(),
                m.getStatus(),
                m.isRented(),
                m.getTenantName(),
                m.getMonthlyRent(),
                m.getDueDay(),
                m.getValuation(),
                Objects.toString(m.getPublishedListingId(), null),
                m.getCreatedAt(),
                m.getUpdatedAt());
    }

    public List<ManagedPropertyDto> toDtos(List<ManagedProperty> records) {
        return records.stream().map(this::toDto).toList();
    }
}
