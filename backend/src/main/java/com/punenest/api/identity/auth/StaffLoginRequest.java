package com.punenest.api.identity.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/**
 * Body for {@code POST /auth/staff-login} (contract {@code StaffLoginRequest}). The internal
 * email+password path for staff/admin; buyers/owners never reach it (they are passwordless, ADR-008).
 *
 * @param email    staff account email (unique, archived-false)
 * @param password plaintext to verify against the stored BCrypt {@code password_hash}
 * @param remember "remember this device"; decides whether the refresh cookie persists across a
 *                 browser restart. Absent means remembered — see {@link LoginRequest#remember}
 */
public record StaffLoginRequest(
        @NotBlank @Email String email,
        @NotBlank String password,
        Boolean remember) {

    /** {@link #remember} with its default applied. */
    public boolean rememberDevice() {
        return remember == null || remember;
    }
}
