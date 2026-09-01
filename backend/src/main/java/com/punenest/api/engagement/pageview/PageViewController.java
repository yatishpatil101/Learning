package com.punenest.api.engagement.pageview;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /page-views} — the one write. There is no read here, on purpose.
 *
 * <p><strong>Why unauthenticated.</strong> Almost every page view on the platform is by somebody who
 * is not signed in, and the report this feeds is specifically about them: the Anonymous-surfers tab
 * measures the people who never made an account and where they gave up. Requiring a session would
 * restrict the traffic report to people who already converted, which answers the one question nobody
 * needed to ask.
 *
 * <p><strong>Why there is no GET.</strong> Reads live under {@code /admin/analytics/*} behind the
 * back-office guards, and they read the daily aggregates rather than this table. A public read here
 * would expose which pages the platform's visitors abandon and at what rate — a competitor's user
 * research, free — and, worse, would be a read over per-session rows. Being able to write telemetry
 * without being able to read it back is the correct asymmetry.
 *
 * <p><strong>Why 202 and an empty body.</strong> The caller is a page doing something else; nothing
 * it renders depends on this having landed, and the ids of the rows are of no use to anybody.
 * Returning them would invite a client to believe it owns the records and can amend them.
 */
@RestController
public class PageViewController {

    private final PageViewService service;

    public PageViewController(PageViewService service) {
        this.service = service;
    }

    /** {@code POST /page-views} (contract {@code recordPageViews}). */
    @PostMapping(Routes.PageViews.BASE)
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void record(@Valid @RequestBody PageViewBatchCreate body,
                       @CurrentUser AuthPrincipal principal) {
        service.record(body, principal);
    }
}
