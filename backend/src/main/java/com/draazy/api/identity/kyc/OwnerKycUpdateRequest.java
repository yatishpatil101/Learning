package com.draazy.api.identity.kyc;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Contract schema {@code OwnerKycUpdate} (spec fix S36).
 *
 * <p>The two real identifiers. The server masks them, stores only the mask, and owns the verdict —
 * so there is no {@code status} or {@code bankVerified} here to send. Accepting those from a client
 * would be self-certified KYC, which is not KYC.
 */
public record OwnerKycUpdateRequest(
        @NotBlank
        @Pattern(regexp = "^[A-Za-z]{5}[0-9]{4}[A-Za-z]$", message = "must be a valid PAN")
        String pan,

        @NotBlank
        @Pattern(regexp = "^[0-9]{12}$", message = "must be a 12-digit Aadhaar number")
        String aadhaar) {
}
