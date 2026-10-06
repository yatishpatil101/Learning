package com.draazy.api.engagement.society;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SocietyQueueSummaryController {

    private final SocietyQueueSummaryService summaries;

    public SocietyQueueSummaryController(SocietyQueueSummaryService summaries) {
        this.summaries = summaries;
    }

    /** The tab counts of the societies console, so it can load only the tab on screen. */
    @GetMapping(Routes.AdminSocieties.SUMMARY)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
            + BackOfficePermissions.REQUIRE_SOCIETIES_READ)
    public SocietyQueueSummaryService.Summary summary() {
        return summaries.summary();
    }
}