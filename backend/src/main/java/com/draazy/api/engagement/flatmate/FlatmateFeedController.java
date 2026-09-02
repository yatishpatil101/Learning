package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The flatmates feed (contract {@code listFlatmateFeed}) — public.
 *
 * <p>Its own controller rather than another method on {@link FlatmateSupplyController}, because it
 * is not a supply endpoint: it reads all three collections and belongs to the discovery surface.
 *
 * <p>{@code view} is the deprecated {@code ?view=} alias kept so old deep links, saved alerts and
 * notification links resolve to the right tab rather than silently falling back to the default —
 * which would show somebody the wrong half of the market and look like a forgotten filter.
 */
@RestController
public class FlatmateFeedController {

    private final FlatmateFeedService service;

    public FlatmateFeedController(FlatmateFeedService service) {
        this.service = service;
    }

    @GetMapping(Routes.Flatmates.FEED)
    public PageResponse<Object> feed(
            @RequestParam(required = false) String tab,
            @RequestParam(required = false) String view,
            @RequestParam(required = false) String locality,
            @RequestParam(required = false) Integer budget,
            @RequestParam(required = false, defaultValue = "false") boolean verifiedOnly,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                service.feed(tab, view, locality, budget, verifiedOnly, Pageables.unsorted(pageable)),
                dto -> dto);
    }
}
