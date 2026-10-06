package com.draazy.api.billing.entitlement;

/** {@code used} is the count {@code ListingQuota.require} refuses a post on, so the wizard paywall mirrors the gate. */
public record ListingEntitlementDto(
        int allowance,
        int referralBonus,
        long used) {
}
