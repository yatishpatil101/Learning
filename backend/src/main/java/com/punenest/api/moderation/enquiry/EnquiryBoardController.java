package com.punenest.api.moderation.enquiry;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/enquiries}, {@code /admin/visits}, {@code /admin/deals} — the demand board.
 *
 * <p>Three routes, all reads, all guarded by the same atom. Why there is no fourth route that writes
 * anything, and why an "enquiry" is a contact request here, are both on {@link EnquiryBoardService}.
 *
 * <p>One controller for three tables owned by two other contexts, which is unusual and is the point:
 * these are not three features, they are three tabs of one page, and the thing they have in common —
 * "how much demand is arriving, and how far down the funnel does it get" — belongs to none of the
 * contexts the rows live in. Splitting it three ways would put a back-office concern inside
 * {@code leads} and {@code deals}, where the next reader would reasonably assume it was part of
 * those features' own contracts.
 */
@RestController
public class EnquiryBoardController {

    private static final String ENQUIRIES_READ =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
                    + BackOfficePermissions.REQUIRE_ENQUIRIES_READ;

    /**
     * Unmasking one row is admin-only, on the same atom (D25).
     *
     * <p>Only the role term is raised, exactly as {@code UserAdminController}'s {@code TIMELINE_READ}
     * does. Minting an {@code enquiries:reveal} atom would put a checkbox on the permissions grid for
     * something that is not a separate capability — it is the same board with a narrower audience —
     * and every atom on that grid is one an administrator has to have an opinion about.
     *
     * <p>A read-only administrator keeps the reveal, which is the point of splitting role from atom:
     * the question is who may see a contact detail, not who may change anything.
     */
    private static final String ENQUIRIES_REVEAL =
            "hasRole('" + Roles.ADMIN + "') and " + BackOfficePermissions.REQUIRE_ENQUIRIES_READ;

    private final EnquiryBoardService service;

    public EnquiryBoardController(EnquiryBoardService service) {
        this.service = service;
    }

    /**
     * {@code GET /admin/enquiries} — contact requests across the marketplace.
     *
     * <p>{@code status} is the console's tab strip: {@code pending}, {@code approved},
     * {@code declined}. Absent means all, which is the board's default view — the useful first
     * question is how much is arriving, not how much is stuck.
     */
    @GetMapping(Routes.Moderation.ADMIN_ENQUIRIES)
    @PreAuthorize(ENQUIRIES_READ)
    public PageResponse<AdminEnquiryDto> enquiries(
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.enquiries(status, pageable), dto -> dto);
    }

    /** {@code GET /admin/visits} — {@code scheduled}, {@code completed}, {@code cancelled}. */
    @GetMapping(Routes.Moderation.ADMIN_VISITS)
    @PreAuthorize(ENQUIRIES_READ)
    public PageResponse<AdminVisitDto> visits(
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.visits(status, pageable), dto -> dto);
    }

    /** {@code GET /admin/deals} — {@code active}, {@code reserved}, {@code closed}. */
    @GetMapping(Routes.Moderation.ADMIN_DEALS)
    @PreAuthorize(ENQUIRIES_READ)
    public PageResponse<AdminDealDto> deals(
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.deals(status, pageable), dto -> dto);
    }

    // --- the audited reveals (D25) ---------------------------------------------------------------

    /**
     * {@code GET /admin/enquiries/{id}} — the same row the list returns, with the requester's mobile
     * unmasked and an {@code audit_log} entry recording that it was.
     *
     * <p>Same DTO as the list on purpose. The difference between the two responses is the value of
     * one field, not the shape of the payload, and a separate {@code AdminEnquiryDetailDto} would
     * imply the console had two things to render when it has one row in two states.
     */
    @GetMapping(Routes.Moderation.ADMIN_ENQUIRY_BY_ID)
    @PreAuthorize(ENQUIRIES_REVEAL)
    public AdminEnquiryDto enquiry(@CurrentUser AuthPrincipal actor, @PathVariable String id) {
        return service.enquiry(actor, id);
    }

    /** {@code GET /admin/visits/{id}} — visitor's mobile unmasked, audited. */
    @GetMapping(Routes.Moderation.ADMIN_VISIT_BY_ID)
    @PreAuthorize(ENQUIRIES_REVEAL)
    public AdminVisitDto visit(@CurrentUser AuthPrincipal actor, @PathVariable String id) {
        return service.visit(actor, id);
    }

    /** {@code GET /admin/deals/{id}} — counterparty's mobile unmasked, audited. */
    @GetMapping(Routes.Moderation.ADMIN_DEAL_BY_ID)
    @PreAuthorize(ENQUIRIES_REVEAL)
    public AdminDealDto deal(@CurrentUser AuthPrincipal actor, @PathVariable String id) {
        return service.deal(actor, id);
    }
}
