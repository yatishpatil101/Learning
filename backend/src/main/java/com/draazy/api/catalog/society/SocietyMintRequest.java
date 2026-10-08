package com.draazy.api.catalog.society;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import com.draazy.api.catalog.listing.NoContactDetails;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Only from a Google Place pick; {@code localityLabel} is folded into the slug to avoid collisions and is not stored. */
public record SocietyMintRequest(
        @NotBlank @Size(max = 255) @Pattern(regexp = "^[A-Za-z0-9_-]+$") String placeId,
        @Size(max = 160) @NoContactDetails String name,
        @Size(max = 120) String localityLabel,
        @Size(max = 120) String localitySlug,
        @DecimalMin("-90.0") @DecimalMax("90.0") Double lat,
        @DecimalMin("-180.0") @DecimalMax("180.0") Double lng,
        @Size(max = 16) String mintOrigin) {
}
