package com.punenest.api.common.trust;

import java.util.UUID;

/**
 * Answers the one question the listing wizard's gate must ask the billing feature: how many live
 * listings is this caller entitled to hold?
 *
 * <p><strong>Why a port in the shared kernel.</strong> Same reason as
 * {@link ContactAllowanceLookup}: {@code package-structure.md} §5 forbids a feature context from
 * importing another, and this check would otherwise make {@code catalog} import {@code billing},
 * where the caller's subscription and their referrals both live. {@code catalog} depends on an
 * abstraction, {@code billing} depends on the kernel, and nobody depends on a feature.
 *
 * <p><strong>This is the allowance, not the balance.</strong> How many listings the caller already
 * holds is a fact about {@code properties}, which {@code catalog} owns and counts for itself.
 * Billing says what you may have; the catalogue says what you have.
 *
 * @see ContactAllowanceLookup the same shape, for the other quota
 */
public interface ListingAllowanceLookup {

    /**
     * How many live listings this caller's plan and referrals permit, in total.
     *
     * <p>Never "unknown". A lookup that cannot answer must still return a number, because a quota
     * check that silently opens the gate on an internal failure is not a quota check — it is a
     * quota check that fails exactly when someone is trying to exceed the quota.
     *
     * @param userId the authenticated caller
     * @return the ceiling, always at least the free tier's
     */
    int listingAllowance(UUID userId);
}
