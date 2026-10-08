package com.draazy.api.catalog.locality;

import com.draazy.api.common.web.Routes;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Public: a visitor picks a locality before they have any reason to sign in. */
@RestController
public class LocalityPickController {

    private final LocalityPlaceService places;

    public LocalityPickController(LocalityPlaceService places) {
        this.places = places;
    }

    @PostMapping(Routes.Localities.RESOLVE)
    public LocalitySummary resolve(@Valid @RequestBody LocalityResolveRequest request) {
        return places.resolve(request);
    }

    @GetMapping(Routes.Localities.SEARCH)
    public List<LocalitySummary> search(@RequestParam(required = false) String q,
            @RequestParam(defaultValue = "10") int limit) {
        return places.search(q, limit);
    }
}