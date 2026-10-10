package com.draazy.api.engagement.follow;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The contract carries no {@code x-roles}; caller-scoping is the guard. */
@RestController
public class SocietyFollowController {

    private final SocietyFollowService followService;

    public SocietyFollowController(SocietyFollowService followService) {
        this.followService = followService;
    }

    /** Sort is fixed to follow-order; {@code Pageables.unsorted} strips a client sort that would add a second
     * {@code order by} against a table with no column to satisfy it. */
    @GetMapping(Routes.Engagement.SOCIETIES_FOLLOWING)
    public PageResponse<FollowedSociety> listFollowing(@CurrentUser AuthPrincipal principal,
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
