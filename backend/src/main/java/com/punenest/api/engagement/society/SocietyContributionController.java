package com.punenest.api.engagement.society;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /societies/{slug}/contributions} — the community tab.
 *
 * <p>Kept separate from {@link SocietyCommunityController} because these six handlers are a
 * different surface with a different gate: anyone signed in may contribute, where the noticeboard
 * next door needs a verified flat. Folding them together would put two authorisation stories in one
 * file and invite the next reader to assume they are the same one.
 *
 * <p>The helpful vote is {@code PUT} to set and {@code DELETE} to clear, rather than one toggle
 * endpoint. Both are idempotent, so a request retried after a timeout on a train produces the state
 * the tap intended instead of undoing it.
 */
@RestController
public class SocietyContributionController {

    private final SocietyContributionService contributions;

    public SocietyContributionController(SocietyContributionService contributions) {
        this.contributions = contributions;
    }

    /**
     * {@code GET /societies/{slug}/contributions} — public, caller-aware.
     *
     * <p>Caller-aware for three things a client cannot work out for itself: whether this reader has
     * already voted, whether a delete control would actually work, and whether they are entitled to
     * see a recommended person's phone number.
     */
    @GetMapping(Routes.Societies.CONTRIBUTIONS)
    public PageResponse<SocietyContributionResponse> list(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug,
            @PageableDefault(size = 50) Pageable pageable) {
        return PageResponse.of(contributions.list(slug, viewerId(principal), isStaff(principal),
                Pageables.unsorted(pageable)), c -> c);
    }

    /** {@code POST /societies/{slug}/contributions} — any signed-in caller. */
    @PostMapping(Routes.Societies.CONTRIBUTIONS)
    @ResponseStatus(HttpStatus.CREATED)
    public SocietyContributionResponse add(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @Valid @RequestBody SocietyContributionRequest body) {
        return contributions.add(slug, principal.userId(), body);
    }

    /** {@code DELETE /societies/{slug}/contributions/{contributionId}} — author, committee or staff. */
    @DeleteMapping(Routes.Societies.CONTRIBUTION)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@CurrentUser AuthPrincipal principal, @PathVariable String slug,
            @PathVariable UUID contributionId) {
        contributions.remove(slug, contributionId, principal.userId(), isStaff(principal));
    }

    /** {@code PUT …/helpful} — mark helpful. Answers with the new count, which is what the button draws. */
    @PutMapping(Routes.Societies.CONTRIBUTION_HELPFUL)
    public SocietyHelpfulResponse markHelpful(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @PathVariable UUID contributionId) {
        return contributions.setHelpful(slug, contributionId, principal.userId(), true);
    }

    /** {@code DELETE …/helpful} — withdraw the vote. */
    @DeleteMapping(Routes.Societies.CONTRIBUTION_HELPFUL)
    public SocietyHelpfulResponse clearHelpful(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @PathVariable UUID contributionId) {
        return contributions.setHelpful(slug, contributionId, principal.userId(), false);
    }

    /** {@code POST …/replies} — any signed-in caller. */
    @PostMapping(Routes.Societies.CONTRIBUTION_REPLIES)
    @ResponseStatus(HttpStatus.CREATED)
    public SocietyContributionReplyResponse reply(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @PathVariable UUID contributionId,
            @Valid @RequestBody SocietyPostRequest body) {
        return contributions.reply(slug, contributionId, principal.userId(), body);
    }

    /** {@code DELETE …/replies/{replyId}} — the reply's own author, the committee or staff. */
    @DeleteMapping(Routes.Societies.CONTRIBUTION_REPLY)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeReply(@CurrentUser AuthPrincipal principal, @PathVariable String slug,
            @PathVariable UUID contributionId, @PathVariable UUID replyId) {
        contributions.removeReply(slug, contributionId, replyId, principal.userId(),
                isStaff(principal));
    }

    /** Null for an anonymous reader — a legitimate state on the list read, not a failure. */
    private static UUID viewerId(AuthPrincipal principal) {
        return principal != null ? principal.userId() : null;
    }

    private static boolean isStaff(AuthPrincipal principal) {
        return principal != null
                && (Roles.Wire.STAFF.equals(principal.role())
                        || Roles.Wire.ADMIN.equals(principal.role()));
    }
}
