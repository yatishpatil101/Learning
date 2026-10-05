package com.draazy.api.identity.verification;

import jakarta.validation.constraints.NotBlank;

public record IdentityRevokeRequest(
        @NotBlank String reason) {
}
