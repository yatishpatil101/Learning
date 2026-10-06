package com.draazy.api.common.settings;

import org.springframework.stereotype.Component;

@Component
public class ListingPolicyController {

    private final PlatformSettings settings;

    public ListingPolicyController(PlatformSettings settings) {
        this.settings = settings;
    }

    public ListingPolicyResponse listingPolicy() {
        return new ListingPolicyResponse(settings.maxListingPhotos());
    }
}
