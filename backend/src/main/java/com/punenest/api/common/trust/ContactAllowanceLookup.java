package com.punenest.api.common.trust;

import java.util.OptionalInt;
import java.util.UUID;

/**
 * Answers the one question the contact gate must ask the billing feature: how many owner contacts is
 * this caller entitled to in total?
 *
 * <p><strong>Why a port in the shared kernel.</strong> {@code package-structure.md} §5 forbids a
 * feature context from importing another, and the quota check would otherwise make {@code leads}
 * import {@code billing} — the caller's subscription and their referrals both live there. Declaring
 * the interface here and implementing it in {@code billing.entitlement} inverts that: {@code leads}
 * depends on an abstraction, {@code billing} depends on the kernel, and nobody depends on a feature.
 * It is the same shape as {@link ContactGate}, pointing the other way, and for the same reason.
 *
 * <p><strong>This is the allowance, not the balance.</strong> How many contacts a caller has already
 * opened is a fact about {@code contact_requests}, which {@code leads} owns and can count for itself;
 * asking billing for it would have meant billing reaching back into leads and the cycle would be
 * real rather than avoided. The split is deliberate and each side answers only what it owns:
 * billing says what you may have, leads says what you have used.
 *
 * @see ContactUsageLookup the mirror of this port, pointing the other way
 */
public interface ContactAllowanceLookup {

    /**
     * How many distinct owners this caller may open a contact request against, in total and for all
     * time.
     *
     * @param userId the authenticated caller
     * @return the ceiling, or {@link OptionalInt#empty()} when the caller's plan lifts it entirely.
     *         Empty means unlimited and never "unknown" — a lookup that cannot answer must return a
     *         number, because a quota check that silently opens the gate on an internal failure is
     *         not a quota check
     */
    OptionalInt contactAllowance(UUID userId);
}
