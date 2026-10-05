package com.draazy.api.services.request;

/**
 * One tenancy row as the registration checker sees it. The mobile is masked: the checker matches
 * the name against the registered copy, not the number. {@code documentUrl} is the exact file the
 * row was prepared from, so the checker never has to pick "the registered copy" out of a list.
 * {@code otpVerified} rows alone can be confirmed registered: a typed number proves nobody holds it.
 */
public record RentAgreementRecordDto(
        String id,
        String tenantName,
        String tenantMobile,
        String status,
        String preparedBy,
        String verifiedBy,
        boolean preparedByYou,
        String documentUrl,
        boolean otpVerified) {
}
