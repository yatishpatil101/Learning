package com.punenest.api.billing.entitlement;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /me/entitlements} — what the authenticated caller is allowed to do (D31b).
 *
 * <p>No {@code @PreAuthorize}: the contract carries no {@code x-roles} and there is no role for
 * which this answer is different. Every authenticated caller is entitled to know their own
 * allowance, and the answer is scoped to {@code principal.userId()} rather than to anything the
 * request can name — there is no path or query parameter here to tamper with, so caller-scoping is
 * the whole of the guard.
 *
 * <p>One verb and no writes. Entitlements are earned by subscribing and by referring; there is
 * nothing to {@code POST} here, and an endpoint that could set an allowance directly would be the
 * one worth attacking.
 */
@RestController
public class MeEntitlementsController {

    private final EntitlementService entitlements;

    public MeEntitlementsController(EntitlementService entitlements) {
        this.entitlements = entitlements;
    }

    @GetMapping(Routes.Plans.ENTITLEMENTS)
    public EntitlementsDto mine(@CurrentUser AuthPrincipal principal) {
        return entitlements.forUser(principal.userId());
    }
}
