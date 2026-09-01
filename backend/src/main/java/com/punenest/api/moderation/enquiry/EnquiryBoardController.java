package com.punenest.api.moderation.enquiry;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.Roles;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
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
}
