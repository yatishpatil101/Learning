package com.draazy.api.engagement.society;

import com.draazy.api.common.web.Routes;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The gates are facts about rows (a verified flat), not roles, so they live in {@link SocietyCommunityService}
 * rather than {@code @PreAuthorize}. */
@RestController
public class SocietyCommunityController {

    private final SocietyCommunityService community;
    private final AccountPermissions permissions;

    public SocietyCommunityController(SocietyCommunityService community,
            AccountPermissions permissions) {
        this.community = community;
        this.permissions = permissions;
    }

    /* ------------------------------------------------------------------ Q&A */

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
        community.remove(slug, itemId, principal.userId(), staffRemoval(principal));
    }

    private boolean isStaff(AuthPrincipal principal) {
        return principal != null
                && Roles.isBackOffice(principal.role())
                && permissions.granted(principal, BackOfficePermissions.SOCIETIES_WRITE);
    }

    private boolean staffRemoval(AuthPrincipal principal) {
        if (principal != null && Roles.isBackOffice(principal.role())
                && !permissions.granted(principal, BackOfficePermissions.SOCIETIES_WRITE)) {
            throw new ForbiddenException("Your account cannot moderate society content.");
        }
        return isStaff(principal);
    }
}
