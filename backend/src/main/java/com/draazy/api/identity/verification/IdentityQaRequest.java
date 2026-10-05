package com.draazy.api.identity.verification;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record IdentityQaRequest(
        @NotBlank String outcome,
        @Size(max = 300) String reason) {
}
