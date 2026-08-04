package com.punenest.api.engagement.flatmate;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;

/**
 * Contract schema {@code FlatmateGroupCreate}.
 *
 * <p>{@code role} and {@code propertyId} are accepted but never believed: the verification tier is
 * derived server-side, and {@code propertyId} is honoured only when the caller genuinely owns an
 * Ops-approved listing. Sending them is how a host <em>asks</em> for the owner tier, not how they
 * get it.
 *
 * @param name the creator's display name — becomes the group's first member
 */
public record FlatmateGroupCreateRequest(
        @NotBlank @Size(min = 3, max = 120) String title,
        @Size(max = 80) String locality,
        String policy,
        @NotNull @Min(1) @Max(10_000_000) Long rent,
        @Min(1) @Max(12) Integer seats,
        @Min(0) @Max(12) Integer seatsOpen,
        @NotBlank @Size(min = 2, max = 80) String name,
        String role,
        String propertyId,
        Boolean agreement,
        Map<String, Object> agreementDoc,
        String consentMobile,
        @Size(max = 20) List<@NotBlank @Size(max = 40) String> tags,
        @Size(max = 600) String note) {
}
