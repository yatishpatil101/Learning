package com.punenest.api.identity.user;

import jakarta.validation.constraints.Email;

/**
 * Body for {@code PATCH /auth/me} (contract {@code UserUpdate}). Deliberately narrow: a user may edit
 * only these self-service profile fields. Identity/trust fields ({@code role}, {@code mobile},
 * {@code mobileVerified}, {@code verified}, …) are server-owned and are NOT accepted here, so a client
 * can never self-escalate by PATCHing them.
 *
 * <p>Null fields are left unchanged (PATCH semantics); a present field overwrites. {@code hideNumber}
 * and {@code verifiedContactOnly} are therefore boxed rather than primitive — a primitive
 * {@code boolean} defaults to {@code false}, which would make "I did not mention this field"
 * indistinguishable from "turn it off", and every profile save would silently republish a hidden
 * number or reopen an owner to unverified callers.
 *
 * @param name       new display name, or null to leave unchanged
 * @param email      new contact email, or null to leave unchanged
 * @param avatar     new avatar URL, or null to leave unchanged
 * @param city       new home city, or null to leave unchanged. Added with {@code hideNumber} (D20):
 *                   the profile form has always sent this field and the contract has never had it, so
 *                   it was parsed and dropped — the user edited their city, got a success toast, and
 *                   nothing changed. A field that is accepted and ignored is worse than one that is
 *                   rejected, because nothing tells anybody
 * @param hideNumber owner privacy preference (D5), or null to leave unchanged
 * @param verifiedContactOnly owner privacy preference (ADR-019), or null to leave unchanged. The
 *                   only self-service field here with real teeth: {@code ContactService#request}
 *                   refuses a contact request outright when the owner has set it and the caller
 *                   holds no L2 badge, and {@code ContactStatusResponse.verificationRequired} tells
 *                   the viewer so before they try. It was readable on {@code GET /auth/me} and
 *                   enforced on every contact attempt long before it was settable — so the one
 *                   person the preference belongs to was the only one who could not change it, and
 *                   the profile screen's toggle silently did nothing on save. Accepted here rather
 *                   than on a bespoke privacy route because it is the same owner editing the same
 *                   row through the same authorisation as {@code hideNumber}, and a second endpoint
 *                   would only be a second place for the two toggles to drift apart
 */
public record UserUpdate(
        String name,
        @Email String email,
        String avatar,
        String city,
        Boolean hideNumber,
        Boolean verifiedContactOnly) {
}
