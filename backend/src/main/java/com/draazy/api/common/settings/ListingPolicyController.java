package com.draazy.api.common.settings;

import com.draazy.api.common.web.Routes;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ListingPolicyController {

    private final PlatformSettings settings;

    public ListingPolicyController(PlatformSettings settings) {
        this.settings = settings;
    }

    @GetMapping(Routes.ListingPolicy.BASE)
    public ListingPolicyResponse listingPolicy() {
        return new ListingPolicyResponse(settings.maxListingPhotos());
    }
}
