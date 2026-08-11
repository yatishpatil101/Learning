package com.punenest.api.identity.user.erasure;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /me/erasure} and {@code /admin/erasure-requests} — the DPDP right to erasure (D177).
 *
 * <p><strong>The two halves are guarded differently, and the asymmetry is the design.</strong> The
 * subject may file and read their own request with no privilege at all, because the right is theirs
 * and gating it behind ops would make a statutory entitlement a favour. Only an admin may decide
 * one, because deciding is destructive, irreversible, and turns on a judgement about competing legal
 * duties that no automated rule can make.
 *
 * <p>Deciding is <strong>admin-only, not staff</strong>, and one rung above every other moderation
 * power in the codebase — listing takedowns, user suspensions and report triage are all
 * staff-or-admin. Those are reversible: a flagged listing can be unflagged, an archived user
 * restored. An executed erasure cannot be undone by anybody, including the person it was done to,
 * because there is no longer an account to appeal from.
 *
 * <p><strong>No capability guard.</strong> Every capability check on this platform is {@code and}-ed
 * onto a role guard and can only narrow it ({@code PermissionMap}), and the map's seeded
 * {@code admin} bundle is {@code ["*"]} — so a capability here would be a second lock on a door with
 * one key, which is the same reason {@code /admin/finance} is left on the role axis alone. If a
 * dedicated {@code decide_erasure} capability is ever added to {@link com.punenest.api.security.Capabilities},
 * this is the method to hang it on.
 *
 * <p>Route constants are declared here rather than in {@code common.web.Routes} — a deliberate,
 * recorded deviation from the convention, made because this slice was written under a write scope
 * that did not include the shared kernel. They should move.
 */
@RestController
public class ErasureController {

    /** {@code POST}/{@code GET} — the subject's own erasure requests. */
    static final String ME_ERASURE = "/me/erasure";

    /** {@code GET} — the admin queue. */
    static final String ADMIN_ERASURE_REQUESTS = "/admin/erasure-requests";

    /** {@code PATCH} — decide one. */
    static final String ADMIN_ERASURE_REQUEST_BY_ID = "/admin/erasure-requests/{id}";

    private static final String ADMIN_ONLY = "hasRole('" + Roles.ADMIN + "')";

    private final ErasureService erasure;

    public ErasureController(ErasureService erasure) {
        this.erasure = erasure;
    }

    /**
     * {@code POST /me/erasure} (contract {@code requestErasure}) — 201.
     *
     * <p>Any authenticated caller, for themselves only. The subject is taken from the principal and
     * there is no body field that could name somebody else — an erasure endpoint that accepted a
     * target id would be a one-request account-deletion attack on any user whose id leaked.
     */
    @PostMapping(ME_ERASURE)
    @ResponseStatus(HttpStatus.CREATED)
    public ErasureRequestResponse request(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ErasureCreateRequest body) {
        return erasure.request(principal, body.reason());
    }

    /**
     * {@code GET /me/erasure} (contract {@code myErasureRequests}) — paged, newest first.
     *
     * <p>Only ever returns pending and rejected requests, and that is not a filter — a completed
     * request no longer carries a subject id, so there is nothing left to scope the query by. The
     * account it belonged to is gone.
     */
    @GetMapping(ME_ERASURE)
    public PageResponse<ErasureRequestResponse> mine(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(erasure.mine(principal, Pageables.unsorted(pageable)), dto -> dto);
    }

    /** {@code GET /admin/erasure-requests} (contract {@code listErasureRequests}) — admin only. */
    @GetMapping(ADMIN_ERASURE_REQUESTS)
    @PreAuthorize(ADMIN_ONLY)
    public PageResponse<ErasureRequestResponse> queue(
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(erasure.queue(status, Pageables.unsorted(pageable)), dto -> dto);
    }

    /**
     * {@code PATCH /admin/erasure-requests/{id}} (contract {@code decideErasureRequest}) — admin
     * only. Carries the erasure out, or refuses it with a recorded reason.
     */
    @PatchMapping(ADMIN_ERASURE_REQUEST_BY_ID)
    @PreAuthorize(ADMIN_ONLY)
    public ErasureRequestResponse decide(@CurrentUser AuthPrincipal principal,
            @PathVariable String id,
            @Valid @RequestBody ErasureDecisionRequest body) {
        return erasure.decide(principal, id, body.decision(), body.note());
    }
}
