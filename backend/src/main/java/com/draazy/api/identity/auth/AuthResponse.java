package com.draazy.api.identity.auth;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.draazy.api.identity.user.UserResponse;

/**
 * Dual-shape response for the auth endpoints: an OTP-send acknowledgement, or a token pair.
 * Shapes, {@code NON_NULL} and the {@link JsonIgnore}d refresh token: docs/flows/consumer/auth.md
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AuthResponse(
        String accessToken,
        @JsonIgnore String refreshToken,
        String tokenType,
        Long expiresIn,
        UserResponse user,
        Boolean otpSent,
        Integer resendAfterSeconds) {

    /** Token-bearing response for a completed authentication. */
    public static AuthResponse tokens(String accessToken, String refreshToken, long expiresInSeconds,
            UserResponse user) {
        return new AuthResponse(accessToken, refreshToken, "Bearer", expiresInSeconds, user, null,
                null);
    }

    /**
     * OTP-send acknowledgement — no tokens yet. Named {@code otpAck} so it does not collide with the
     * record's generated {@code otpSent()} accessor; the cooldown is the server's, not the client's.
     */
    public static AuthResponse otpAck(int resendAfterSeconds) {
        return new AuthResponse(null, null, null, null, null, Boolean.TRUE, resendAfterSeconds);
    }
}
