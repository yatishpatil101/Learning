package com.draazy.api.documents.agreement;

import java.time.LocalDate;

/** Contract schema {@code RentAgreement}. */
public record RentAgreementDto(
        String id,
        String propertyId,
        String tenantMobile,
        Long rent,
        Long deposit,
        LocalDate startDate,
        Integer durationMonths,
        String status,
        String documentUrl) {

    static RentAgreementDto of(RentAgreement a) {
        return new RentAgreementDto(a.getId().toString(), a.getPropertyId().toString(),
                a.getTenantMobile(), a.getRent(), a.getDeposit(), a.getStartDate(),
                a.getDurationMonths(), a.getStatus(), a.getDocumentUrl());
    }
}
