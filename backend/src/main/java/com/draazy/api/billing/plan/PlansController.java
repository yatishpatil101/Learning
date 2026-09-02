package com.draazy.api.billing.plan;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The plan price list and the caller's subscription to one. */
@RestController
public class PlansController {

    private final SubscriptionService service;

    public PlansController(SubscriptionService service) {
        this.service = service;
    }

    /** {@code GET /plans} (contract {@code listPlans}) — public, {@code security: []}. */
    @GetMapping(Routes.Plans.BASE)
    public List<PlanDto> listPlans() {
        return service.listPlans();
    }

    /** {@code GET /me/subscription} (contract {@code getSubscription}). */
    @GetMapping(Routes.Plans.SUBSCRIPTION)
    public SubscriptionDto getSubscription(@CurrentUser AuthPrincipal principal) {
        return service.getSubscription(principal);
    }

    /**
     * {@code POST /me/subscription} (contract {@code subscribe}, spec fix S50) — 201.
     *
     * @param idempotencyKey the contract's {@code Idempotency-Key}; a repeat returns the original row
     */
    @PostMapping(Routes.Plans.SUBSCRIPTION)
    @ResponseStatus(HttpStatus.CREATED)
    public SubscriptionDto subscribe(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody SubscribeRequest body,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return service.subscribe(principal, body, idempotencyKey);
    }
}
