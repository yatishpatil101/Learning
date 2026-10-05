package com.draazy.api.engagement.helpfeedback;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Store feedback before building reports because these rows cannot be recreated later. */
@RestController
public class HelpFeedbackController {

    private final HelpFeedbackService service;

    public HelpFeedbackController(HelpFeedbackService service) {
        this.service = service;
    }

    @PostMapping(Routes.HelpFeedback.BASE)
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void record(@Valid @RequestBody HelpFeedbackCreate body,
                       @CurrentUser AuthPrincipal principal,
                       HttpServletRequest request) {
        service.record(body, principal, request.getRemoteAddr());
    }
}
