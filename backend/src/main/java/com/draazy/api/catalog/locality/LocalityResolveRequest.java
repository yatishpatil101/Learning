package com.draazy.api.catalog.locality;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/** What the client says the picked Google place is; only the dev lookup trusts it, a real one re-reads Google. */
public record LocalityResolveRequest(
        @NotBlank @Size(max = 300) @Pattern(regexp = "^[A-Za-z0-9_-]+$") String placeId,
        @NotBlank @Size(max = 160) String name,
        @DecimalMin("-90") @DecimalMax("90") Double lat,
        @DecimalMin("-180") @DecimalMax("180") Double lng,
        @Size(max = 20) List<@Size(max = 60) String> types) {
}