package com.draazy.api.moderation.enquiry;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Three tabs of one page over tables owned by {@code leads} and {@code deals}, kept out of those contexts. */
@RestController
public class EnquiryBoardController {

    private static final String ENQUIRIES_READ =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
                    + BackOfficePermissions.REQUIRE_ENQUIRIES_READ;

    private final EnquiryBoardService service;

    public EnquiryBoardController(EnquiryBoardService service) {
        this.service = service;
    }

    /** {@code GET /admin/enquiries} — {@code pending}, {@code approved}, {@code declined}; absent means all. */
    @GetMapping(Routes.Moderation.ADMIN_ENQUIRIES)
    @PreAuthorize(ENQUIRIES_READ)
    public PageResponse<AdminEnquiryDto> enquiries(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Integer days,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.enquiries(status, q, days, pageable), dto -> dto);
    }

    /** {@code GET /admin/visits} — {@code scheduled}, {@code completed}, {@code cancelled}. */
    @GetMapping(Routes.Moderation.ADMIN_VISITS)
    @PreAuthorize(ENQUIRIES_READ)
    public PageResponse<AdminVisitDto> visits(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Integer days,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.visits(status, q, days, pageable), dto -> dto);
    }

    /** {@code GET /admin/deals} — {@code active}, {@code reserved}, {@code closed}. */
    @GetMapping(Routes.Moderation.ADMIN_DEALS)
    @PreAuthorize(ENQUIRIES_READ)
    public PageResponse<AdminDealDto> deals(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String deal,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Integer days,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.deals(status, deal, q, days, pageable), dto -> dto);
    }

    /** Board totals plus the funnel; {@code days} and {@code deal} narrow only the funnel. */
    @GetMapping(Routes.Moderation.ADMIN_ENQUIRIES_SUMMARY)
    @PreAuthorize(ENQUIRIES_READ)
    public AdminEnquirySummary summary(
            @RequestParam(required = false) Integer days,
            @RequestParam(required = false) String deal) {
        return service.summary(days, deal);
    }

    // Detail reads write an audit row: opening one person's row is logged, browsing the list is not.
    @GetMapping(Routes.Moderation.ADMIN_ENQUIRY_BY_ID)
    @PreAuthorize(ENQUIRIES_READ)
    public AdminEnquiryDto enquiry(@CurrentUser AuthPrincipal actor, @PathVariable String id) {
        return service.enquiry(actor, id);
    }

    @GetMapping(Routes.Moderation.ADMIN_VISIT_BY_ID)
    @PreAuthorize(ENQUIRIES_READ)
    public AdminVisitDto visit(@CurrentUser AuthPrincipal actor, @PathVariable String id) {
        return service.visit(actor, id);
    }

    @GetMapping(Routes.Moderation.ADMIN_DEAL_BY_ID)
    @PreAuthorize(ENQUIRIES_READ)
    public AdminDealDto deal(@CurrentUser AuthPrincipal actor, @PathVariable String id) {
        return service.deal(actor, id);
    }
}
