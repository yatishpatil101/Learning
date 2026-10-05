package com.draazy.api.identity.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/**
 * Body for {@code POST /auth/staff-login} (contract {@code StaffLoginRequest}): step one of staff
 * sign-in. A correct password earns a second-factor challenge, never tokens.
 *
 * @param email    staff account email (unique, archived-false)
 * @param password plaintext to verify against the stored BCrypt {@code password_hash}
 */
public record StaffLoginRequest(
        @NotBlank @Email String email,
        @NotBlank String password) {
}
