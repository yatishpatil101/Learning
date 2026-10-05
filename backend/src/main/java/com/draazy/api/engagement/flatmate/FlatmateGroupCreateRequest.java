package com.draazy.api.engagement.flatmate;

import static com.draazy.api.engagement.flatmate.FlatmateVocabulary.NO_CONTACT;

import com.draazy.api.catalog.listing.NoContactDetails;
import com.draazy.api.common.validation.IndianMobile;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;

@FlatDescribedUnlessHunting
/** Contract schema {@code FlatmateGroupCreate}. {@code role} and {@code propertyId} are accepted but
 * never believed — the tier is derived server-side and the listing must genuinely be the caller's. */
public record FlatmateGroupCreateRequest(
        @NotBlank @Size(min = 3, max = 120) @NoContactDetails(message = NO_CONTACT) String title,
        @Size(max = 80) String locality,
        String policy,
        @Min(1) @Max(10_000_000) Long rent,
        @Min(0) @Max(10_000_000) Long deposit,
        @Min(0) @Max(180) Integer noticePeriodDays,
        @Min(0) @Max(24) Integer lockInMonths,
        String maintenanceBilling,
        String electricityBilling,
        @Min(1) @Max(FlatmateGroup.MAX_SEATS) Integer seats,
        @Min(0) @Max(FlatmateGroup.MAX_SEATS) Integer seatsOpen,
        @NotBlank @Size(min = 2, max = 80) @NoContactDetails(message = NO_CONTACT) String name,
        String role,
        String propertyId,
        Boolean agreement,
        Map<String, Object> agreementDoc,
        @IndianMobile String consentMobile,
        @Size(max = 20) List<@NotBlank @Size(max = 40) @NoContactDetails(message = NO_CONTACT) String> tags,
        @Size(max = 600) @NoContactDetails(message = NO_CONTACT) String note,
        @Valid FlatmateGroupPreferences preferences) {

    boolean hunting() {
        return preferences != null;
    }
}
