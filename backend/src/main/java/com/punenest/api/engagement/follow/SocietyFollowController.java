package com.punenest.api.engagement.follow;

import com.punenest.api.catalog.society.SocietyResponse;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /me/societies} — the caller's follows: the toggle on the society hub, and the list.
 *
 * <p>Both toggles are idempotent (204 always). The contract carries no {@code x-roles};
 * caller-scoping is the guard.
 */
@RestController
public class SocietyFollowController {

    private final SocietyFollowService followService;

    public SocietyFollowController(SocietyFollowService followService) {
        this.followService = followService;
    }

    /**
     * {@code GET /me/societies/following} (contract {@code listFollowedSocieties}) — paged.
     *
     * <p>Sort is fixed to follow-order (newest first) inside the query, so no client sort is
     * accepted; {@code Pageables.unsorted} strips one rather than letting it produce a second
     * {@code order by} against a table that has no column to satisfy it.
     */
    @GetMapping(Routes.Engagement.SOCIETIES_FOLLOWING)
    public PageResponse<SocietyResponse> listFollowing(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                followService.listFollowed(principal.userId(), Pageables.unsorted(pageable)),
                s -> s);
    }

    /** {@code PUT /me/societies/{slug}/follow} (contract {@code followSociety}) — idempotent, 204. */
    @PutMapping(Routes.Engagement.SOCIETY_FOLLOW)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void follow(@CurrentUser AuthPrincipal principal, @PathVariable String slug) {
        followService.follow(principal.userId(), slug);
    }

    /** {@code DELETE /me/societies/{slug}/follow} (contract {@code unfollowSociety}) — idempotent, 204. */
    @DeleteMapping(Routes.Engagement.SOCIETY_FOLLOW)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unfollow(@CurrentUser AuthPrincipal principal, @PathVariable String slug) {
        followService.unfollow(principal.userId(), slug);
    }
}
