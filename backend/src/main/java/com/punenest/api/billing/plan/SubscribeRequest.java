package com.punenest.api.billing.plan;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Contract {@code SubscribeRequest}.
 *
 * <p>{@code paymentMethod} is validated against the contract's enum and then dropped — the method is
 * chosen on the gateway's own checkout page and there is no column for it. Rejecting a value the
 * contract does not allow is still worth doing: it catches a client typo at the edge rather than
 * letting it sit in a request nobody reads.
 *
 * <p>No {@code price} field, deliberately. See {@link SubscriptionService}.
 */
public record SubscribeRequest(
        @NotBlank String planId,
        @Pattern(regexp = "upi|card|netbanking") String paymentMethod) {
}
