package com.draazy.api.engagement.society;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /societies/{slug}/questions} and {@code /societies/{slug}/board}.
 *
 * <p><strong>Why the two reads are public and the two writes are not the same shape as each other.</strong>
 * Asking a question needs only an account; posting a notice needs a verified flat. Neither rule is a
 * role, so neither is a {@code @PreAuthorize} — the board's gate is a fact about a row in
 * {@code society_residents} and lives in {@link SocietyCommunityService}. This controller only tells
 * the service whether the caller is staff, which is the one part it can know from the token.
 *
 * <p>Both {@code POST}s answer <strong>201</strong>, unlike the residency and claim writes next door:
 * these genuinely create a new row every time. A second question is a second question.
 */
@RestController
public class SocietyCommunityController {

    private final SocietyCommunityService community;

    public SocietyCommunityController(SocietyCommunityService community) {
        this.community = community;
    }

    /* ------------------------------------------------------------------ Q&A */

    /** {@code GET /societies/{slug}/questions} — public, newest first, answers attached. */
    @GetMapping(Routes.Societies.QUESTIONS)
    public PageResponse<SocietyQuestionResponse> questions(@PathVariable String slug,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(community.questions(slug, Pageables.unsorted(pageable)), q -> q);
    }

    /** {@code POST /societies/{slug}/questions} — any signed-in caller. */
    @PostMapping(Routes.Societies.QUESTIONS)
    @ResponseStatus(HttpStatus.CREATED)
    public SocietyQuestionResponse ask(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @Valid @RequestBody SocietyPostRequest body) {
        return community.ask(slug, principal.userId(), body);
    }

    /** {@code POST /societies/{slug}/questions/{questionId}/answers} — any signed-in caller. */
    @PostMapping(Routes.Societies.ANSWERS)
    @ResponseStatus(HttpStatus.CREATED)
    public SocietyAnswerResponse answer(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @PathVariable UUID questionId,
            @Valid @RequestBody SocietyPostRequest body) {
        return community.answer(slug, questionId, principal.userId(), body);
    }

    /* ---------------------------------------------------------------- board */

    /**
     * {@code GET /societies/{slug}/board} — public, caller-aware.
     *
     * <p>Caller-aware only for {@code canRemove}: the rows themselves are the same for everyone,
     * but whether a delete control is drawn is not, and working that out on the client from a
     * display name would get it wrong the moment two residents share one.
     */
    @GetMapping(Routes.Societies.BOARD)
    public PageResponse<SocietyBoardItemResponse> board(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug,
            @RequestParam(required = false) String kind,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(community.board(slug, kind, viewerId(principal), isStaff(principal),
                Pageables.unsorted(pageable)), b -> b);
    }

    /** {@code POST /societies/{slug}/board} — verified resident, committee or staff. */
    @PostMapping(Routes.Societies.BOARD)
    @ResponseStatus(HttpStatus.CREATED)
    public SocietyBoardItemResponse post(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @Valid @RequestBody SocietyBoardItemRequest body) {
        return community.post(slug, principal.userId(), isStaff(principal), body);
    }

    /** {@code DELETE /societies/{slug}/board/{itemId}} — author, committee or staff. */
    @DeleteMapping(Routes.Societies.BOARD_ITEM)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@CurrentUser AuthPrincipal principal, @PathVariable String slug,
            @PathVariable UUID itemId) {
        community.remove(slug, itemId, principal.userId(), isStaff(principal));
    }

    /** Null for an anonymous reader — a legitimate state on both reads, not a failure. */
    private static UUID viewerId(AuthPrincipal principal) {
        return principal != null ? principal.userId() : null;
    }

    private static boolean isStaff(AuthPrincipal principal) {
        return principal != null
                && (Roles.Wire.STAFF.equals(principal.role()) || Roles.Wire.ADMIN.equals(principal.role()));
    }
}
