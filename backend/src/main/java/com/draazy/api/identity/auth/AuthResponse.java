package com.draazy.api.identity.auth;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.draazy.api.identity.user.UserResponse;
import java.util.List;

/**
 * Response for the auth endpoints: an OTP-send acknowledgement, a staff second-factor challenge, or
 * a token pair. Shapes, {@code NON_NULL} and the {@link JsonIgnore}d refresh token:
 * docs/flows/consumer/auth.md
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AuthResponse(
        String accessToken,
        @JsonIgnore String refreshToken,
        String tokenType,
        Long expiresIn,
        UserResponse user,
        Boolean otpSent,
        Integer resendAfterSeconds,
        String mfa,
        String challenge,
        List<String> recoveryCodes) {

    /** {@link #mfa} when the account has an authenticator and must enter its code. */
    public static final String MFA_TOTP = "totp";

    /** {@link #mfa} when the account has no authenticator yet and must set one up first. */
    public static final String MFA_ENROL = "enrol";

    /** Token-bearing response for a completed authentication. */
    public static AuthResponse tokens(String accessToken, String refreshToken, long expiresInSeconds,
            UserResponse user) {
        return new AuthResponse(accessToken, refreshToken, "Bearer", expiresInSeconds, user, null,
                null, null, null, null);
    }

    /**
     * OTP-send acknowledgement — no tokens yet. Named {@code otpAck} so it does not collide with the
     * record's generated {@code otpSent()} accessor; the cooldown is the server's, not the client's.
     */
    public static AuthResponse otpAck(int resendAfterSeconds) {
        return new AuthResponse(null, null, null, null, null, Boolean.TRUE, resendAfterSeconds, null,
                null, null);
    }

    /** Password accepted; no tokens until the second factor is presented. */
    public static AuthResponse secondFactor(String mfa, String challenge) {
        return new AuthResponse(null, null, null, null, null, null, null, mfa, challenge, null);
    }

    /** The just-confirmed enrolment's one and only showing of its recovery codes. */
    public AuthResponse withRecoveryCodes(List<String> codes) {
        return new AuthResponse(accessToken, refreshToken, tokenType, expiresIn, user, otpSent,
                resendAfterSeconds, mfa, challenge, List.copyOf(codes));
    }
}
