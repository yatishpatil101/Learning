package com.punenest.api.catalog.society;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/society-candidates} — ops confirming the societies members added themselves.
 *
 * <p>The third of the three society queues that read the operator's own browser and were therefore
 * permanently empty. This one is the worst of them: a member-added society could never be promoted,
 * so the community-minting funnel on four separate surfaces fed a queue with no exit.
 *
 * <p>Guarded by the same {@code societies:read} / {@code societies:write} atoms as the leads, claims
 * and proposal desks. They are one job seen from four ends, and a fifth atom would leave an existing
 * ops account silently unable to clear one of the four queues it already works.
 */
@RestController
public class SocietyCandidateAdminController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private static final String SOCIETIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_READ;

    private static final String SOCIETIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_WRITE;

    private final SocietyMintService minting;

    public SocietyCandidateAdminController(SocietyMintService minting) {
        this.minting = minting;
    }

    /**
     * {@code GET /admin/society-candidates} — member-added societies nobody has checked, oldest
     * first.
     *
     * <p>Oldest first for the reason every work queue here is: the society that has waited longest
     * is the one somebody is still waiting on.
     */
    @GetMapping(Routes.SocietyCandidates.BASE)
    @PreAuthorize(SOCIETIES_READ)
    public PageResponse<SocietyResponse> queue(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                minting.candidates(Pageables.unsorted(pageable), principal.userId()), s -> s);
    }

    /**
     * {@code POST /admin/society-candidates/{slug}/verify} — confirm one is real.
     *
     * <p>A {@code POST} on a sub-resource rather than a {@code PATCH} of the society, because this
     * is not an edit of the society's facts: it records that a named operator looked at it on a
     * given day. Nothing about the building changes, which is exactly why {@code registration} and
     * {@code conveyance} are left alone.
     *
     * <p>409 if somebody already verified it. The second operator clearing the same queue should be
     * told, not silently overwrite the record of who did it first.
     */
    @PostMapping(Routes.SocietyCandidates.VERIFY)
    @PreAuthorize(SOCIETIES_WRITE)
    public SocietyResponse verify(@CurrentUser AuthPrincipal principal, @PathVariable String slug) {
        return minting.verify(slug, principal.userId());
    }

    /**
     * {@code GET /admin/society-candidates/{slug}/duplicates} — societies this one may already be.
     *
     * <p>Separate from the queue rather than embedded in each row, and the reason is cost: the scan
     * compares a name against the whole catalogue, and folding it into the list would run it twenty
     * times to render one screen when an operator opens at most one candidate's hints at a time.
     *
     * <p>A read, not a write. Nothing here merges anything — the operator takes the hint to the
     * merge desk, or ignores it. That separation is deliberate: an automatic merge on a 0.4 score
     * would fold two real buildings into one, and the listings, follows and reviews that had
     * accumulated against the loser would move with it.
     *
     * @param limit how many hints to return; a handful of chips, not a report
     */
    @GetMapping(Routes.SocietyCandidates.DUPLICATES)
    @PreAuthorize(SOCIETIES_READ)
    public List<SocietyDuplicateSuggestion> duplicates(@PathVariable String slug,
            @RequestParam(defaultValue = "6") int limit) {
        return minting.duplicates(slug, limit);
    }
}
