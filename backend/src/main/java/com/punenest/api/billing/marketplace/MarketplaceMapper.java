package com.punenest.api.billing.marketplace;

import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Entity→wire projection for the marketplace. Hand-written for the same reason as
 * {@code PlanMapper} (api-standards §8.1).
 */
@Component
public class MarketplaceMapper {

    public ServiceOfferingDto toDto(ServiceOffering offering) {
        return new ServiceOfferingDto(
                offering.getId().toString(),
                offering.getName(),
                offering.getCategory(),
                offering.getStartingPrice(),
                offering.getDescription());
    }

    public List<ServiceOfferingDto> toOfferingDtos(List<ServiceOffering> offerings) {
        return offerings.stream().map(this::toDto).toList();
    }

    public ServiceOrderDto toDto(ServiceOrder order) {
        return new ServiceOrderDto(
                order.getId().toString(),
                order.getOfferingId().toString(),
                order.getStatus(),
                order.getAmount(),
                order.getScheduledFor(),
                order.getCreatedAt());
    }

    public List<ServiceOrderDto> toOrderDtos(List<ServiceOrder> orders) {
        return orders.stream().map(this::toDto).toList();
    }
}
