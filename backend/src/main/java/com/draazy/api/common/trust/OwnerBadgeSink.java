package com.draazy.api.common.trust;

import java.util.UUID;

/**
 * Kernel port: badge back-fill onto an owner's listings; synchronous so it commits with the flag
 * flip. Rationale: docs/system/cross-cutting.md#feature-to-feature-ports-in-the-shared-kernel
 */
public interface OwnerBadgeSink {

    /** Stamp every listing this owner holds as owner-verified; safe on an owner with no listings. */
    int markOwnerVerified(UUID ownerId);

    /** Clear the owner badge from every listing; needed when an administrator revokes a hand grant. */
    int markOwnerUnverified(UUID ownerId);
}
