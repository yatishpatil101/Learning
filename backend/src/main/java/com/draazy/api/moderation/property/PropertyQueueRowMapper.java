package com.draazy.api.moderation.property;

import com.draazy.api.catalog.property.Freshness;
import com.draazy.api.catalog.property.ListingProgress;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.common.trust.BackOfficeVisibility;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.OutreachCounts;
import com.draazy.api.moderation.signal.ListingSignals;
import java.time.Instant;
import org.springframework.stereotype.Component;

/** Hand-written: the row is the desk's view, so every private field it carries is revealed on purpose. */
@Component
public class PropertyQueueRowMapper {

    private final PropertyMapper properties;

    public PropertyQueueRowMapper(PropertyMapper properties) {
        this.properties = properties;
    }

    public PropertyQueueRow toRow(Property p, OutreachCounts outreach, ListingSignals signals,
            boolean ownerReplied) {
        return new PropertyQueueRow(
                p.getId().toString(),
                p.getSlug(),
                p.getTitle(),
                p.getDeal(),
                p.getPropertyType(),
                p.getBhk(),
                p.getPrice(),
                p.getArea(),
                p.getAreaUnit(),
                p.getFurnishing(),
                p.getLocality(),
                p.getLocalitySlug(),
                p.getCity(),
                properties.coverImage(p),
                p.getStatus(),
                ListingProgress.of(p, true),
                p.getCreatedAt(),
                p.getLastConfirmedAt(),
                Freshness.of(p.getLastConfirmedAt(), p.getCreatedAt(), Instant.now()).wire(),
                p.getResubmittedAt(),
                p.getOwnershipRequestedAt(),
                p.isRecheckPending(),
                p.getRecheckReason(),
                p.getRecheckRequestedAt(),
                p.isFeatured(),
                p.isArchived(),
                p.isOwnerVerified(),
                p.isOwnershipVerified(),
                p.getViews(),
                p.getEnquiries(),
                p.getDocsCount(),
                properties.photoCount(p),
                p.getDescription() == null ? 0 : p.getDescription().length(),
                p.getAmenities() == null ? 0 : p.getAmenities().size(),
                p.getFacing(),
                p.getFloor(),
                p.getAgeYears(),
                p.getDeposit(),
                p.getAvailableFrom(),
                p.getPossession(),
                properties.toOwner(p.getOwner(), ContactVisibility.REVEALED),
                properties.toAdminPipeline(p, BackOfficeVisibility.VISIBLE, outreach),
                signals,
                ownerReplied);
    }
}
