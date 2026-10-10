package com.draazy.api.billing.entitlement;

/** {@code used} can exceed {@code free} after a referral clawback; {@code remaining} then stays zero,
 * and an agreement already delivered is never taken back. */
public record AgreementEntitlementDto(int free, int used, int remaining) {
}