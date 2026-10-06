package com.draazy.api.moderation.signal;

import com.draazy.api.catalog.property.PropertyResponse;
import com.fasterxml.jackson.annotation.JsonUnwrapped;

public record PropertyModerationResponse(
        @JsonUnwrapped PropertyResponse property,
        ListingSignals signals,
        boolean ownerReplied) {
}
