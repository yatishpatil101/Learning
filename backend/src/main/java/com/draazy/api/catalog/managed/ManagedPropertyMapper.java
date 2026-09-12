package com.draazy.api.catalog.managed;

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

    /**
     * Maps a manual rent receipt (V120). Nothing is re-derived from the parent property here on
     * purpose — the row already holds the snapshot taken when the month was recorded, and reading
     * the property instead would silently rewrite receipts a tenant already has.
     */
    public ManagedRentReceiptDto toDto(ManagedRentReceipt r) {
        return new ManagedRentReceiptDto(
                r.getId().toString(),
                r.getRentMonth(),
                r.getAmount(),
                r.getTenantName(),
                r.getLandlordName(),
                r.getPropertyAddress(),
                r.getCreatedAt());
    }

    /**
     * The plural sibling of {@link #toDtos(List)}, named for its element type rather than matching
     * it — erasure makes {@code List<ManagedProperty>} and {@code List<ManagedRentReceipt>} the same
     * signature, so the two plurals cannot share a name the way the singular {@code toDto} pair does.
     */
    public List<ManagedRentReceiptDto> toReceiptDtos(List<ManagedRentReceipt> receipts) {
        return receipts.stream().map(this::toDto).toList();
    }
}
