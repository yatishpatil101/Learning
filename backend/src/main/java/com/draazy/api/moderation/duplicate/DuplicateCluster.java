package com.draazy.api.moderation.duplicate;

import com.draazy.api.catalog.property.PropertyResponse;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

public record DuplicateCluster(
        String id,
        String reason,
        boolean sameOwner,
        List<Hint> hints,
        List<Listing> listings) {

    /** The doorway arm: a shared electricity meter, or a shared address key within one locality. */
    public static final String REASON_ADDRESS = "address";

    public static final String REASON_IMAGE = "image";

    public static final String REASON_BOTH = REASON_ADDRESS + "+" + REASON_IMAGE;

    public record Hint(String code, String severity, String detail) {
    }

    /** One member of a cluster: what the side-by-side card prints, not the whole listing. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Listing(
            String id,
            String slug,
            String title,
            Long price,
            String status,
            String coverImage,
            String locality,
            String pincode,
            boolean verified,
            Instant createdAt,
            PropertyResponse.Owner owner) {
    }
}
