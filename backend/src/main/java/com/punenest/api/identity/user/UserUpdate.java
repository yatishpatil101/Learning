package com.punenest.api.identity.user;

import jakarta.validation.constraints.Email;

/**
 * Body for {@code PATCH /auth/me} (contract {@code UserUpdate}). Deliberately narrow: a user may edit
 * only these self-service profile fields. Identity/trust fields ({@code role}, {@code mobile},
 * {@code mobileVerified}, {@code verified}, …) are server-owned and are NOT accepted here, so a client
 * can never self-escalate by PATCHing them.
 *
 * <p>Null fields are left unchanged (PATCH semantics); a present field overwrites.
 *
 * @param name   new display name, or null to leave unchanged
 * @param email  new contact email, or null to leave unchanged
 * @param avatar new avatar URL, or null to leave unchanged
 */
public record UserUpdate(
        String name,
        @Email String email,
        String avatar) {
}
