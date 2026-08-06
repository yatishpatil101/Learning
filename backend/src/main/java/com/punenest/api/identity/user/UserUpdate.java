package com.punenest.api.identity.user;

import jakarta.validation.constraints.Email;

/**
 * Body for {@code PATCH /auth/me} (contract {@code UserUpdate}). Deliberately narrow: a user may edit
 * only these self-service profile fields. Identity/trust fields ({@code role}, {@code mobile},
 * {@code mobileVerified}, {@code verified}, …) are server-owned and are NOT accepted here, so a client
 * can never self-escalate by PATCHing them.
 *
 * <p>Null fields are left unchanged (PATCH semantics); a present field overwrites. {@code hideNumber}
 * is therefore boxed rather than primitive — a primitive {@code boolean} defaults to {@code false},
 * which would make "I did not mention this field" indistinguishable from "turn it off", and every
 * profile save would silently republish a hidden number.
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
 */
public record UserUpdate(
        String name,
        @Email String email,
        String avatar,
        String city,
        Boolean hideNumber) {
}
