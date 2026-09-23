package com.draazy.api.engagement.helpfeedback;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Why this route is write-only, unauthenticated and answers 202 with no body is in the OpenAPI
 * description of {@code recordHelpFeedback}.
 *
 * <p>There is no admin read yet either. The back-office screen — helpful-rate per article, comments
 * under the worst ones — is an afternoon's work whenever someone wants it and is useless until
 * there are rows, so the rows, which cannot be done retroactively, start first. Tracked in
 * {@code tasks/todo.md}.
 */
@RestController
public class HelpFeedbackController {

    private final HelpFeedbackService service;

    public HelpFeedbackController(HelpFeedbackService service) {
        this.service = service;
    }

    /** {@code POST /help/feedback} (contract {@code recordHelpFeedback}). */
    @PostMapping(Routes.HelpFeedback.BASE)
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void record(@Valid @RequestBody HelpFeedbackCreate body,
                       @CurrentUser AuthPrincipal principal) {
        service.record(body, principal);
    }
}
