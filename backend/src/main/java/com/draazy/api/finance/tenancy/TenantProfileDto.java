package com.draazy.api.finance.tenancy;

import java.time.LocalDate;

/**
 * Wire shape of a tenant's screening profile (contract {@code TenantProfile}); score and verified
 * server-owned. Rationale: docs/flows/consumer/rent-tenancy.md#tenant-screening-score-badge-batch-reads
 */
public record TenantProfileDto(
        String mobile,
        String name,
        String occupation,
        Long income,
        String occupants,
        LocalDate moveIn,
        String priorLandlord,
        String about,
        Integer score,
        boolean verified) {
}
