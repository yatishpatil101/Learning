package com.draazy.api.identity.verification;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Set;

/** Body of {@code POST /moderation/identity-reviews/{id}/reject}. */
public record IdentityRejectRequest(
        @NotBlank String reason,
        @Size(max = 300) String note) {

    /** Mirrors the V23 CHECK on {@code rejection_reason} and the {@code IdentityRejectionReason} enum. */
    public static final Set<String> REASONS =
            Set.of("blurry", "cropped", "mismatch", "expired", "not_holder", "unsupported", "other");
}
