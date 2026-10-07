package com.draazy.api.services.request;

/** {@code documentUrl} is the exact file the row was prepared from; only {@code otpVerified} rows can be confirmed registered, as a typed number proves nobody holds it. */
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
