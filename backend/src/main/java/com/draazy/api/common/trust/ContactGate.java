package com.draazy.api.common.trust;

import java.util.UUID;

/**
 * Answers the one question the catalogue must ask the contacts feature: may this viewer see this
 * listing owner's raw mobile?
 *
 * <p><strong>Why a port in the shared kernel.</strong> {@code package-structure.md} §5 forbids a
 * feature context from importing another feature context, and the contact reveal would otherwise make
 * {@code catalog} import {@code leads}. Declaring the interface here (the shared kernel imports no
 * feature) and implementing it in {@code leads.contact} inverts that dependency: {@code catalog}
 * depends on an abstraction, {@code leads} depends on the kernel, and nobody depends on a feature.
 * The seam is worth its keep precisely because the consumer is the security-critical masking path on
 * the busiest public endpoint — this is the one place a quiet cross-feature import would be costly.
 *
 * <p>The signature is ids only, per the same rule: no entity, no DTO, nothing that could drag a
 * feature's model into the kernel.
 */
public interface ContactGate {

    /**
     * Resolve the reveal decision for one viewer against one listing.
     *
     * @param viewerId   the authenticated caller, or {@code null} for an anonymous request
     * @param propertyId the listing being viewed
     * @param ownerId    the listing's owner (the catalogue already holds it; passing it avoids a
     *                   second lookup and keeps this port free of a listing repository)
     * @return {@link ContactVisibility#REVEALED} only when the viewer owns the listing or holds an
     *         approved contact request for it; {@link ContactVisibility#MASKED} in every other case,
     *         including anonymous, pending and declined
     */
    ContactVisibility visibilityFor(UUID viewerId, UUID propertyId, UUID ownerId);
}
