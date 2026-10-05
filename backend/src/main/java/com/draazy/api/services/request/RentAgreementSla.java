package com.draazy.api.services.request;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;

// Computed on read, not swept: sandbox schedulers may never fire.
// Customer-decision drafts carry no desk deadline.
final class RentAgreementSla {

    static final String DESK = "desk";
    static final String CUSTOMER = "customer";

    static final Duration PICKUP = Duration.ofHours(4);
    static final Duration FIRST_DRAFT = Duration.ofHours(48);
    static final Duration REVISION = Duration.ofHours(24);
    static final Duration REGISTRATION = Duration.ofDays(7);

    private static final Map<ServiceRequestStatus, Duration> DESK_TARGETS = new EnumMap<>(Map.of(
            ServiceRequestStatus.NEW, PICKUP,
            ServiceRequestStatus.ASSIGNED, FIRST_DRAFT,
            ServiceRequestStatus.IN_PROGRESS, FIRST_DRAFT,
            ServiceRequestStatus.CHANGES_REQUESTED, REVISION,
            ServiceRequestStatus.APPROVED, REGISTRATION));

    private RentAgreementSla() {
    }

    static ServiceRequestDto.Sla of(ServiceRequest request, Instant now) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            return null;
        }
        if (request.getStatus() == ServiceRequestStatus.DRAFT_SHARED) {
            return new ServiceRequestDto.Sla(CUSTOMER, null, false);
        }
        Duration target = DESK_TARGETS.get(request.getStatus());
        if (target == null || request.getStatusChangedAt() == null) {
            return null;
        }
        Instant due = request.getStatusChangedAt().plus(target);
        return new ServiceRequestDto.Sla(DESK, due, now.isAfter(due));
    }
}
