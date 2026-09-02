package com.draazy.api.engagement.history;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The signed-in "resume your search" rail at {@code /me/recent-searches} (V121).
 *
 * <p>Both operations are scoped to the {@link AuthPrincipal} resolved from the JWT, and neither
 * takes an account identifier — not in the path, not in the body. There is therefore no parameter a
 * caller could change to read or write another user's history; the isolation is a property of the
 * contract rather than a check that could be forgotten. No {@code @PreAuthorize}: authentication is
 * the whole gate, and every signed-in user has their own rail.
 *
 * <p>Anonymous visitors never reach here. Their trail stays in the browser, which is where a record
 * of what somebody looked for belongs until they have asked us to keep it for them.
 */
@RestController
public class MeRecentSearchesController {

    private final RecentSearchService service;

    public MeRecentSearchesController(RecentSearchService service) {
        this.service = service;
    }

    /** {@code GET /me/recent-searches} — the caller's rail, newest first, at most six. */
    @GetMapping(Routes.Engagement.RECENT_SEARCHES)
    public List<RecentSearchDto> mine(@CurrentUser AuthPrincipal principal) {
        return service.list(principal.userId());
    }

    /**
     * {@code PUT /me/recent-searches} — record a search, or move an existing one back to the top.
     *
     * <p>{@code PUT} because it is idempotent by URL: the same search recorded twice leaves one
     * entry with a newer timestamp. Returns the caller's whole rail after the write, so a client
     * never has to model the eviction to know what it now has.
     */
    @PutMapping(Routes.Engagement.RECENT_SEARCHES)
    public List<RecentSearchDto> record(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody RecentSearchRequest body) {
        return service.record(principal.userId(), body.label(), body.url());
    }
}
