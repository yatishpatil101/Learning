package com.draazy.api.moderation.conversation;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/conversations} — moderation reads of private chat (contract tag {@code Moderation},
 * tech debt D53).
 *
 * <p>Guarded exactly like the neighbouring moderation reads: a role term {@code and}-ed with a
 * back-office atom, per {@code api-standards.md} §6 and the shape {@link
 * com.draazy.api.moderation.report.ReportController} established. The role term is
 * {@code staff or admin} rather than {@code admin} alone even though {@code conversations:read} is
 * admin-only in the catalogue, and that is on purpose: the atom is the narrowing and the role is the
 * gate, and inverting that would leave the route with a guard whose strength depended on the
 * permission document — the thing the atom is explicitly forbidden from being. A staffer therefore
 * fails on the atom and gets 403, which is the same answer they get on any other admin-only surface.
 *
 * <p>One operation, and no list. There is deliberately no {@code GET /admin/conversations} — a
 * browsable index of everyone's private chat is a different and much larger power than reading one
 * thread named by a report, and nothing on the platform needs it. A moderator arrives here with an
 * id from a report.
 */
@RestController
public class ModeratedConversationController {

    private static final String CONVERSATIONS_READ =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
                    + BackOfficePermissions.REQUIRE_CONVERSATIONS_READ;

    private final ModeratedConversationService service;

    public ModeratedConversationController(ModeratedConversationService service) {
        this.service = service;
    }

    /** {@code GET /admin/conversations/{id}} (contract {@code getConversationForModeration}). */
    @GetMapping(Routes.Moderation.ADMIN_CONVERSATION)
    @PreAuthorize(CONVERSATIONS_READ)
    public ModeratedConversationDto get(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return service.read(principal, id);
    }
}
