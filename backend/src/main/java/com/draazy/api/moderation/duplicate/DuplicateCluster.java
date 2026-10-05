package com.draazy.api.moderation.duplicate;

import com.draazy.api.catalog.property.PropertyResponse;
import java.util.List;

public record DuplicateCluster(
        String id,
        String reason,
        boolean sameOwner,
        List<Hint> hints,
        List<PropertyResponse> listings) {

    /** The doorway arm: a shared electricity meter, or a shared address key within one locality. */
    public static final String REASON_ADDRESS = "address";

    public static final String REASON_IMAGE = "image";

    public static final String REASON_BOTH = REASON_ADDRESS + "+" + REASON_IMAGE;

    public record Hint(String code, String severity, String detail) {
    }
}
