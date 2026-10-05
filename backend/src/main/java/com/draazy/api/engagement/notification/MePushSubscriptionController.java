package com.draazy.api.engagement.notification;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
public class MePushSubscriptionController {

    private final PushSubscriptionService service;

    public MePushSubscriptionController(PushSubscriptionService service) {
        this.service = service;
    }

    @PostMapping(Routes.Engagement.PUSH_SUBSCRIPTIONS)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void upsert(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody PushSubscriptionRequest body) {
        service.upsert(principal.userId(), body);
    }

    @DeleteMapping(Routes.Engagement.PUSH_SUBSCRIPTIONS)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@CurrentUser AuthPrincipal principal,
            @RequestParam @NotBlank String endpoint) {
        service.delete(principal.userId(), endpoint);
    }
}
