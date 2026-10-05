package com.draazy.api.identity.auth;

/**
 * A new authenticator secret, shown once (contract {@code StaffTotpEnrolment}).
 *
 * @param secret     base32, for typing into an app that cannot scan
 * @param otpauthUri the same secret as the {@code otpauth://} URI a QR code carries
 */
public record StaffTotpEnrolment(String secret, String otpauthUri) {
}
