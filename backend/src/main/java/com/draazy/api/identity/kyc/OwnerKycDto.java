package com.draazy.api.identity.kyc;

/** Contract schema {@code OwnerKyc}. Every field is server-owned; the raw PAN/Aadhaar never appear. */
public record OwnerKycDto(
        String panMasked,
        String aadhaarMasked,
        boolean bankVerified,
        String status) {

    static OwnerKycDto of(OwnerKyc k) {
        return new OwnerKycDto(k.getPanMasked(), k.getAadhaarMasked(), k.isBankVerified(),
                k.getStatus());
    }

    /**
     * What an owner who has never submitted anything sees.
     *
     * <p>A {@code 200} with an empty record rather than a {@code 404}: the contract declares only
     * a {@code 200}, and "you have not done your KYC yet" is a state of the caller's own account,
     * not a missing resource. A 404 would also force every client to treat a normal first visit as
     * an error case.
     */
    static OwnerKycDto empty() {
        return new OwnerKycDto(null, null, false, OwnerKycStatuses.PENDING);
    }
}
