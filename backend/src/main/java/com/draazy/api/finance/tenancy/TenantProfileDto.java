package com.draazy.api.finance.tenancy;

import java.time.LocalDate;

/**
 * A tenant's screening profile as the wire sees it (contract {@code TenantProfile}, spec fix S21).
 *
 * <p>{@link #score} and {@link #verified} are server-computed and absent from
 * {@link TenantProfileUpdateRequest} — a tenant who could set them would be grading the very signal
 * owners rely on (spec fix S17).
 *
 * @param mobile        the tenant's number; masked unless the reader is the tenant themselves
 * @param occupation    free text
 * @param income        monthly income, whole INR
 * @param occupants     one of {@link OccupantTypes}
 * @param moveIn        earliest date the tenant can move in
 * @param priorLandlord reference contact, free text
 * @param about         the tenant's own introduction
 * @param score         computed trust score, 0–100
 * @param verified      mirrors the Aadhaar badge
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
