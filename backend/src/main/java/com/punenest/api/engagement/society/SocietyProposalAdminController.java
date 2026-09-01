package com.punenest.api.engagement.society;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/society-proposals} — ops screening what the community says about a society.
 *
 * <p>The queue whose absence made all three features theatre. It used to read the operator's own
 * browser, so it was permanently empty however many residents filled the form in on theirs.
 *
 * <p>Guarded by the same {@code societies:read} / {@code societies:write} atoms as the leads and
 * claims desks, for the reason given on {@link SocietyClaimAdminController}: they are one job seen
 * from three ends, and a fourth atom would leave an existing ops account silently unable to clear
 * one of the three queues it already works.
 *
 * <p>The WhatsApp invite is visible here, unlike everywhere else, because screening a link for a
 * scam is the entire point of the review.
 */
@RestController
public class SocietyProposalAdminController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private static final String SOCIETIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_READ;

    private static final String SOCIETIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_WRITE;

    private final SocietyProposalService proposals;

    public SocietyProposalAdminController(SocietyProposalService proposals) {
        this.proposals = proposals;
    }

    /**
     * {@code GET /admin/society-proposals} — the queue, oldest first.
     *
     * <p>Oldest first is the opposite of every consumer feed here and is right for a queue: the
     * proposal that has waited longest is the one somebody is still waiting on.
     */
    @GetMapping(Routes.SocietyProposals.BASE)
    @PreAuthorize(SOCIETIES_READ)
    public PageResponse<SocietyProposalResponse> queue(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String kind,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(proposals.queue(status, kind, Pageables.unsorted(pageable)), p -> p);
    }

    /**
     * {@code PATCH /admin/society-proposals/{id}} — approve or reject.
     *
     * <p>Approving writes the value onto the society in the same transaction. A proposal marked
     * approved whose value never reached the catalogue looks identical to one that did, which is
     * why there is no separate "applied" step to fail between them.
     */
    @PatchMapping(Routes.SocietyProposals.BY_ID)
    @PreAuthorize(SOCIETIES_WRITE)
    public SocietyProposalResponse decide(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody SocietyProposalDecisionRequest body) {
        return proposals.decide(id, principal.userId(), body);
    }
}
