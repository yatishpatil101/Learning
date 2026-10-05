package com.draazy.api.engagement.flatmate;

import static com.draazy.api.engagement.flatmate.FlatmateVocabulary.NO_CONTACT;

import com.draazy.api.catalog.listing.NoContactDetails;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/** Contract schema {@code FlatmateSeekerPostCreate}; also serves the PATCH. Enum-valued fields are
 * checked in the service against {@link FlatmateVocabulary} so the message can list what was expected. */
public record FlatmateSeekerPostCreateRequest(
        @NotBlank @Size(min = 2, max = 80) @NoContactDetails(message = NO_CONTACT) String name,
        String gender,
        @Min(18) @Max(120) Integer age,
        @Size(max = 80) @NoContactDetails(message = NO_CONTACT) String occupation,
        @NotNull @Min(1) @Max(10_000_000) Long budget,
        @Min(1) @Max(10_000_000) Long budgetMax,
        @NotEmpty @Size(max = 10) List<@NotBlank @Size(max = 80) String> localities,
        @Size(max = 40) String moveIn,
        String flatPref,
        String roomPref,
        @Size(max = 20) List<@NotBlank @Size(max = 40) @NoContactDetails(message = NO_CONTACT) String> tags,
        @Size(max = 600) @NoContactDetails(message = NO_CONTACT) String note,
        Boolean verifiedContactOnly,
        @Size(max = 120) @NoContactDetails(message = NO_CONTACT) String title) {
}
