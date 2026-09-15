package com.draazy.api.engagement.flatmate;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Contract schema {@code FlatmateRoomCreate} — a single spare room from the list-property flow.
 * Trust signals stay server-side; see docs/flows/consumer/flatmates.md#supply-side-rationale-moved-from-backend-javadoc.
 */
public record FlatmateRoomCreateRequest(
        String bhk,
        @NotBlank String roomType,
        String attachedBath,
        String furnishing,
        @Size(max = 32) String facing,
        @Size(max = 32) String overlooking,
        @NotBlank @Size(max = 80) String locality,
        String societyId,
        @Size(max = 120) String society,
        @Size(max = 40) String flatNumber,
        @NotNull @Min(1) @Max(10_000_000) Long rentShare,
        @Min(0) @Max(10_000_000) Long deposit,
        LocalDate availableFrom,
        String lookingFor,
        String foodPref,
        @Size(max = 20) List<@NotBlank @Size(max = 40) String> lifestyle,
        String hostRole,
        Boolean agreementDeclared,
        Map<String, Object> agreementDoc,
        String ownerConsentMobile,
        @NotEmpty @Size(max = 12) List<@NotBlank @Size(max = 500) String> photos,
        @Size(max = 600) String note,
        Double lat,
        Double lng) {
}
