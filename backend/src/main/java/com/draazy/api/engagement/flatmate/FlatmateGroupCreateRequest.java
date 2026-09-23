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

/** Contract schema {@code FlatmateGroupCreate}. {@code role} and {@code propertyId} are accepted but
 * never believed — the tier is derived server-side and the listing must genuinely be the caller's. */
public record FlatmateGroupCreateRequest(
        @NotBlank @Size(min = 3, max = 120) String title,
        @NotBlank @Size(max = 80) String locality,
        String policy,
        @NotNull @Min(1) @Max(10_000_000) Long rent,
        @Min(0) @Max(10_000_000) Long deposit,
        @Min(0) @Max(180) Integer noticePeriodDays,
        @Min(0) @Max(24) Integer lockInMonths,
        String maintenanceBilling,
        String electricityBilling,
        @Min(1) @Max(12) Integer seats,
        @Min(0) @Max(12) Integer seatsOpen,
        @NotBlank @Size(min = 2, max = 80) String name,
        String role,
        String propertyId,
        Boolean agreement,
        Map<String, Object> agreementDoc,
        @Size(max = 60) String agreementRegNo,
        LocalDate agreementRegisteredOn,
        LocalDate agreementValidTill,
        @IndianMobile String consentMobile,
        @Size(max = 20) List<@NotBlank @Size(max = 40) String> tags,
        @Size(max = 600) String note) {
}
