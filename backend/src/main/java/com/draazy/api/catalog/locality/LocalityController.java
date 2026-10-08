package com.draazy.api.catalog.locality;

import com.draazy.api.common.web.Routes;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** Public because locality landing pages are reached before a visitor has reason to sign in. */
@RestController
public class LocalityController {

    private final LocalityService localityService;

    public LocalityController(LocalityService localityService) {
        this.localityService = localityService;
    }

    @GetMapping(Routes.Localities.BASE)
    public List<LocalityResponse> list() {
        return localityService.list();
    }

    @GetMapping(Routes.Localities.BY_SLUG)
    public LocalityResponse get(@PathVariable String slug) {
        return localityService.get(slug);
    }
}
