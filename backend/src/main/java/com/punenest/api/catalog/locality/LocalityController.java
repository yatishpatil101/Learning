package com.punenest.api.catalog.locality;

import com.punenest.api.common.web.Routes;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /localities} — Pune's areas, the unit almost every search, price signal and URL is keyed on.
 *
 * <p>Public ({@code security: []}): these are the landing pages a visitor arrives on from search,
 * long before there is any reason to sign in.
 */
@RestController
public class LocalityController {

    private final LocalityService localityService;

    public LocalityController(LocalityService localityService) {
        this.localityService = localityService;
    }

    /** {@code GET /localities} — every active locality, alphabetical, with true listing counts. */
    @GetMapping(Routes.Localities.BASE)
    public List<LocalityResponse> list() {
        return localityService.list();
    }

    /** {@code GET /localities/{slug}} — one locality; 404 if it does not exist or is retired. */
    @GetMapping(Routes.Localities.BY_SLUG)
    public LocalityDetailResponse get(@PathVariable String slug) {
        return localityService.get(slug);
    }
}
