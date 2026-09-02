package com.draazy.api.common.trust;

import java.time.Instant;
import java.util.UUID;

/**
 * A way to announce that a listing cleared the ownership-document gate, without knowing who cares.
 *
 * <p><strong>Why a port.</strong> Verification is written by
 * {@code moderation.verification.OwnershipVerificationService} (layer 6, where D190 put it, because
 * granting the badge is a staff judgement on evidence); the one thing that currently needs to hear
 * about it is referral qualification in {@code billing} (layer 2). That arrow points
 * <em>downward</em>, so — unlike {@link ContactGate}, which exists because its arrow did not — a
 * direct call from {@code moderation} into {@code billing.referral} would compile and would pass
 * {@code ArchitectureBoundaryTest}. The port is kept anyway, and the reason is knowledge rather
 * than compilation: the moderation desk decides that documents are genuine, and it should not also
 * have to know that somebody is paid when they are. Declaring the interface in the shared kernel
 * and implementing it in {@code billing.referral} leaves the verification path able to state the
 * fact without naming a single consumer, exactly as {@link Notifier} and {@link RatingLookup}
 * already do for their own cross-context needs.
 *
 * <p><strong>Why this event and no other.</strong> Q17 (closed 2026-08-11) rules that a referral
 * credits the referrer when the referee's <em>first listing passes verification</em>, because
 * clearing the document gate is the one qualifying action that is already expensive to fake. That
 * makes "ownership verified" the single fact worth announcing across the boundary.
 *
 * <p><strong>Deliberately no lapse event.</strong> Verification expires (D190: recurring proof after
 * 90 days, site photos after 180), and it is tempting to announce the lapse too so a referral could
 * be reversed. It should not be. The credit records that real documents were produced and checked at
 * a real moment; a later expiry does not retroactively make that false, it only means the badge has
 * gone stale. Reversal after the fact is a fraud finding, and the fraud desk already owns it —
 * {@code clawed-back} exists for exactly that and is deliberately distinct from {@code rejected}.
 * Wiring expiry to clawback would silently punish honest owners for the passage of time.
 */
public interface VerificationAnnouncer {

    /**
     * Announce that {@code propertyId}, owned by {@code ownerId}, has passed ownership verification.
     *
     * <p>Runs inside the caller's transaction, as {@link Notifier#notify} does: if the verification
     * write rolls back, whatever this triggered rolls back with it. That is the correct coupling
     * here rather than a convenience — a referral qualified by a verification that never committed
     * would be a credit minted against nothing, which is the exact failure D191 exists to close.
     *
     * <p>Announced once per property, on the transition into the verified state. Implementations
     * must nonetheless tolerate a repeat: re-verification after a lapse is a legitimate second
     * transition on the same property, and it must not mint a second credit.
     *
     * @param ownerId    the listing's owner — the referred party, if they were referred at all
     * @param propertyId the listing that cleared the gate
     * @param verifiedAt when it cleared, supplied by the caller rather than read from the clock so
     *                   the announcement carries the same instant that was persisted
     */
    void announceOwnershipVerified(UUID ownerId, UUID propertyId, Instant verifiedAt);
}
