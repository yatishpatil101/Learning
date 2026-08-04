package com.punenest.api.engagement.follow;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /me/societies/{slug}/follow} — the follow toggle on the society hub.
 *
 * <p>Both operations are idempotent (204 always). The contract carries no {@code x-roles};
 * caller-scoping is the guard.
 */
@RestController
public class SocietyFollowController {

    private final SocietyFollowService followService;

    public SocietyFollowController(SocietyFollowService followService) {
        this.followService = followService;
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
