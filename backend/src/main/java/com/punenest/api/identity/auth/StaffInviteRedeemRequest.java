package com.punenest.api.identity.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body for {@code POST /auth/staff-invite/redeem} (contract {@code StaffInviteRedeem}, tech debt
 * D206). The one route on which a back-office colleague chooses their own password — nobody else,
 * including the two administrators who co-signed the account, ever supplies it.
 *
 * <p>The length floor is here rather than in the service because it is a property of the request,
 * and 422 with a field name is a better answer than a service exception. Twelve characters is the
 * NIST 800-63B guidance for a human-chosen secret with no composition rules attached; the ceiling
 * exists because BCrypt silently truncates past 72 bytes, and a password that is quietly not the one
 * the user typed is worse than a refusal.
 *
 * @param token    the single-use invite, delivered out of band to the account's holder
 * @param password the plaintext to store as the account's BCrypt {@code password_hash}
 */
public record StaffInviteRedeemRequest(
        @NotBlank String token,
        @NotBlank @Size(min = 12, max = 72) String password) {
}
