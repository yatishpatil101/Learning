package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.validation.IndianMobile;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Contract schema {@code FlatmateRoomCreate}. Trust signals stay server-side; see
 * docs/flows/consumer/flatmates.md#supply-side-rationale-moved-from-backend-javadoc. */
public record FlatmateRoomCreateRequest(
        String homeTypeLabel,
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
        @Min(0) @Max(3) Integer occupants,
        @Min(1) @Max(6) Integer maxOccupants,
        @Min(0) @Max(180) Integer noticePeriodDays,
        @Min(0) @Max(24) Integer lockInMonths,
        String maintenanceBilling,
        String electricityBilling,
        LocalDate availableFrom,
        String lookingFor,
        String foodPref,
        @Size(max = 20) List<@NotBlank @Size(max = 40) String> lifestyle,
        String hostRole,
        String propertyId,
        Boolean agreementDeclared,
        Map<String, Object> agreementDoc,
        @Size(max = 60) String agreementRegNo,
        LocalDate agreementRegisteredOn,
        LocalDate agreementValidTill,
        @IndianMobile String ownerConsentMobile,
        @Size(max = 12) List<@NotBlank @Size(max = 500) String> photos,
        @Size(max = 600) String note,
        Double lat,
        Double lng) {
}
