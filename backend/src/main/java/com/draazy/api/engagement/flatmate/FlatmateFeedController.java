package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The flatmates feed (contract {@code listFlatmateFeed}) — public. Its own controller because it
 * reads all three collections: discovery, not supply. Facets: docs/flows/consumer/flatmates.md §5.
 */
@RestController
public class FlatmateFeedController {

    private final FlatmateFeedService service;

    public FlatmateFeedController(FlatmateFeedService service) {
        this.service = service;
    }

    @GetMapping(Routes.Flatmates.FEED)
    public FlatmateFeedResponse<Object> feed(
            @RequestParam(required = false) String tab,
            @RequestParam(required = false) String view,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String locality,
            @RequestParam(required = false) Double nearLat,
            @RequestParam(required = false) Double nearLng,
            @RequestParam(required = false) Double nearRadiusKm,
            @RequestParam(required = false) Long minBudget,
            @RequestParam(required = false) Long maxBudget,
            @RequestParam(required = false) Long budget,
            @RequestParam(required = false) String gender,
            @RequestParam(required = false, defaultValue = "false") boolean verifiedOnly,
            @RequestParam(required = false) Integer moveInDays,
            @RequestParam(required = false) List<String> habits,
            @RequestParam(required = false) String attachedBath,
            @RequestParam(required = false) Integer sharing,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) List<String> meLocalities,
            @RequestParam(required = false) Long meBudget,
            @RequestParam(required = false) String meGender,
            @PageableDefault(size = 20) Pageable pageable) {

        FlatmateSearchQuery facets = new FlatmateSearchQuery(
                FlatmateVocabulary.resolveTab(tab, view), q, locality,
                nearLat, nearLng, nearRadiusKm,
                minBudget, maxBudget == null ? budget : maxBudget,
                gender, verifiedOnly, moveInDays, habits, attachedBath, sharing,
                sort, meLocalities, meBudget, meGender);

        FlatmateFeedService.FeedResult result =
                service.feed(facets, Pageables.unsorted(pageable));
        return FlatmateFeedResponse.of(
                PageResponse.of(result.page(), dto -> dto), result.verifiedTotal());
    }
}
