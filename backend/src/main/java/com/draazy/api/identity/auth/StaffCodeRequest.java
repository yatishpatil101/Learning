package com.draazy.api.identity.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body for the staff second-factor steps (contract {@code StaffCodeRequest}).
 *
 * @param challenge the password step's challenge
 * @param code      a 6-digit authenticator code, or a recovery code where the step accepts one
 * @param remember  "remember this device"; absent means remembered — see {@link LoginRequest#remember}
 */
public record StaffCodeRequest(
        @NotBlank String challenge,
        @NotBlank @Size(max = 32) String code,
        Boolean remember) {

    public boolean rememberDevice() {
        return remember == null || remember;
    }
}
