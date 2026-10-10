package com.draazy.api.billing.plan;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The caller's subscription. The plan catalogue is the {@code plans} section of {@code GET /bootstrap}. */
@RestController
public class PlansController {

    private final SubscriptionService service;

    public PlansController(SubscriptionService service) {
        this.service = service;
    }

    /** {@code GET /me/subscription} (contract {@code getSubscription}). */
    @GetMapping(Routes.Plans.SUBSCRIPTION)
    public SubscriptionState getSubscription(@CurrentUser AuthPrincipal principal) {
        return SubscriptionState.of(service.getSubscription(principal));
    }

    /** A repeated {@code Idempotency-Key} returns the original row. */
    @PostMapping(Routes.Plans.SUBSCRIPTION)
    @ResponseStatus(HttpStatus.CREATED)
    public SubscriptionDto subscribe(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody SubscribeRequest body,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return service.subscribe(principal, body, idempotencyKey);
    }
}
