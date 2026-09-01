package com.punenest.api.common.trust;

import java.util.UUID;

/**
 * Tells the catalogue that an owner's identity badge has changed, so their listings can carry it.
 *
 * <p><strong>Why a port in the shared kernel.</strong> {@code package-structure.md} §5 forbids a
 * feature context from importing another at the same or a higher layer, and the badge back-fill
 * would otherwise make {@code identity} (layer 0) import {@code catalog} (layer 1) — an upward edge,
 * and a cycle, since {@code catalog} already reads {@code identity} to resolve an owner. Declaring
 * the interface here and implementing it in {@code catalog.property} inverts it: {@code identity}
 * depends on an abstraction, {@code catalog} depends on the kernel, and nobody depends upward. Same
 * shape as {@link ContactGate}, for the same reason and in the opposite direction.
 *
 * <p>The signature is ids only, per the same rule: no entity, no DTO, nothing that could drag a
 * feature's model into the kernel.
 *
 * <p><strong>A port, not an event.</strong> The back-fill has to land in the same transaction as the
 * flag flip on the user — a profile that says "verified" while the owner's listings still tell
 * buyers otherwise is the exact failure this call exists to prevent, and an event delivered later
 * (or dropped) would reintroduce that window. When the two writes must commit together, the seam is
 * a synchronous port.
 */
public interface OwnerBadgeSink {

    /**
     * Stamp every listing this owner holds as owner-verified.
     *
     * <p>Called once, when identity verification first succeeds. It is only the back-fill half of
     * keeping the denormalised column true — listings created *after* verification are stamped from
     * the owner at birth by the listing write path — so an implementation must be safe to run
     * against an owner with no listings at all.
     *
     * @param ownerId the user who just earned the badge
     * @return how many listings were updated, for the caller's audit trail
     */
    int markOwnerVerified(UUID ownerId);

    /**
     * Take the owner badge back off every listing this owner holds.
     *
     * <p>The mirror of {@link #markOwnerVerified}, and it exists because the badge became
     * withdrawable: {@code PATCH /users/{id}/badge} lets an administrator revoke a badge they or a
     * colleague granted by hand. Without this half, revoking would clear the pill on the profile and
     * leave every listing still telling buyers the owner is verified — the same inconsistency the
     * back-fill was written to prevent, in the direction that actually misleads somebody.
     *
     * <p>Note that the Aadhaar-earned badge is <em>not</em> revocable through that route, so in
     * practice this only ever unwinds an operator's own assertion.
     *
     * @param ownerId the user whose badge was withdrawn
     * @return how many listings were updated; zero for an owner with no listings
     */
    int markOwnerUnverified(UUID ownerId);
}
