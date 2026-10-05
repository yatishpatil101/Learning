package com.draazy.api.catalog.property;

import com.draazy.api.common.web.Routes;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PropertyCountsController {

    private final PropertyCountsService counts;

    public PropertyCountsController(PropertyCountsService counts) {
        this.counts = counts;
    }

    @GetMapping(Routes.Properties.COUNTS)
    public PropertyCountsResponse counts() {
        return counts.counts();
    }
}
