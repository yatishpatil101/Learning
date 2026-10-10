package com.draazy.api.admin;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AdminHelpFeedbackController {

    private static final String SETTINGS_READ =
            "hasRole('" + Roles.ADMIN + "') and " + BackOfficePermissions.REQUIRE_SETTINGS_READ;

    private final AdminHelpFeedbackService feedback;

    public AdminHelpFeedbackController(AdminHelpFeedbackService feedback) {
        this.feedback = feedback;
    }

    @GetMapping(Routes.Admin.HELP_FEEDBACK)
    @PreAuthorize(SETTINGS_READ)
    public PageResponse<AdminHelpFeedbackArticle> articles(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return feedback.articles(page, size);
    }

    @GetMapping(Routes.Admin.HELP_FEEDBACK_COMMENTS)
    @PreAuthorize(SETTINGS_READ)
    public PageResponse<AdminHelpFeedbackComment> comments(
            @RequestParam(required = false) String slug,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return feedback.comments(slug, page, size);
    }
}
