package com.draazy.api.identity.verification;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/** Body of {@code POST /moderation/identity-reviews/{id}/approve} — what the reviewer read off the card. */
public record IdentityApproveRequest(
        @NotBlank @Size(max = 40) String number,
        @NotBlank @Size(min = 2, max = 120) String name,
        @NotNull LocalDate dob) {
}
