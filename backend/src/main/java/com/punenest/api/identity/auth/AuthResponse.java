package com.punenest.api.identity.auth;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.punenest.api.identity.user.UserResponse;

/**
 * Response for the auth endpoints (contract {@code AuthResponse}). Two distinct shapes ride this one
 * record because the contract models login as a single dual-mode op:
 * <ul>
 *   <li>the OTP <em>send</em> step returns only {@code otpSent:true} (no tokens);</li>
 *   <li>a successful <em>verify</em>/staff-login/refresh returns the token pair + {@code user}.</li>
 * </ul>
 * {@code NON_NULL} inclusion keeps each shape clean — the send response serializes to just
 * {@code {"otpSent":true}}, and token responses omit {@code otpSent}.
 *
 * <p>{@code refreshToken} rides this record but is {@link JsonIgnore}d: it leaves the server in an
 * {@code HttpOnly} cookie ({@link RefreshCookie}), never in the body, so no client script can read
 * it. The field stays because {@link AuthController} is the one caller that needs the raw value —
 * to build that cookie — and threading it back through a second return type would buy nothing.
 *
 * @param accessToken  short-lived (≤15 min) HS256 JWT bearer token
 * @param refreshToken rotating opaque refresh token (single-use); serialized as a cookie, not JSON
 * @param tokenType    always {@code Bearer}
 * @param expiresIn    access-token lifetime in seconds
 * @param user         the authenticated user's public profile
 * @param otpSent      {@code TRUE} on the OTP-send step; null otherwise
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AuthResponse(
        String accessToken,
        @JsonIgnore String refreshToken,
        String tokenType,
        Long expiresIn,
        UserResponse user,
        Boolean otpSent) {

    /** Token-bearing response for a completed authentication. */
    public static AuthResponse tokens(String accessToken, String refreshToken, long expiresInSeconds,
            UserResponse user) {
        return new AuthResponse(accessToken, refreshToken, "Bearer", expiresInSeconds, user, null);
    }

    /**
     * OTP-send acknowledgement — no tokens issued yet. Named {@code otpAck} (not {@code otpSent}) so
     * it doesn't collide with the record's generated {@code otpSent()} accessor.
     */
    public static AuthResponse otpAck() {
        return new AuthResponse(null, null, null, null, null, Boolean.TRUE);
    }
}
