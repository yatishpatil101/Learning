package com.draazy.api.identity.verification;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Set;

public record IdentityRejectRequest(
        @NotBlank String reason,
        @Size(max = 300) String note) {

    public static final String NOT_REVIEWED = "not_reviewed";
    public static final Set<String> NOTE_REQUIRED_REASONS = Set.of("mismatch", "not_holder", "other");
    public static final Set<String> STAFF_REASONS =
            Set.of("blurry", "cropped", "mismatch", "expired", "not_holder", "unsupported", "other");
    public static final Set<String> REASONS =
            Set.of("blurry", "cropped", "mismatch", "expired", "not_holder", "unsupported", "other",
                    NOT_REVIEWED);
}
