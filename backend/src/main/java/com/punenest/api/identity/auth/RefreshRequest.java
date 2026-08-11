package com.punenest.api.identity.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body for {@code POST /auth/refresh} (contract {@code RefreshRequest}). Carries the opaque refresh
 * token issued by a prior login/refresh; rotation + reuse-detection live in {@code RefreshTokenService}.
 *
 * @param refreshToken the raw refresh token to exchange for a fresh access/refresh pair
 */
public record RefreshRequest(
        @NotBlank @Size(max = 512) String refreshToken) {
}
