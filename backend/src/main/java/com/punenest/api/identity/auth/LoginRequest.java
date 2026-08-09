package com.punenest.api.identity.auth;

import com.punenest.api.common.validation.IndianMobile;
import jakarta.validation.constraints.NotBlank;

/**
 * Body for {@code POST /auth/login} (contract {@code LoginRequest}). Single dual-mode endpoint: send
 * only {@code mobile} to trigger OTP delivery, then resend with {@code otp} to verify and receive
 * tokens (see {@code AuthService#login}).
 *
 * <p>{@code mobile} is validated against the contract {@code Mobile} pattern here (fail fast at the
 * edge with a 422, before any DB work). {@code password} is accepted for contract-compatibility but
 * ignored — consumers are passwordless (ADR-008); staff use {@code /auth/staff-login}.
 *
 * @param mobile   Indian 10-digit mobile, the account's natural identity
 * @param otp      one-time code; absent on the send step, present on the verify step
 * @param password contract-only; not used on the consumer path
 */
public record LoginRequest(
        @NotBlank @IndianMobile
        String mobile,
        String otp,
        String password) {

    /** True when the caller supplied an OTP (the verify step); false on the send step. */
    public boolean hasOtp() {
        return otp != null && !otp.isBlank();
    }
}
