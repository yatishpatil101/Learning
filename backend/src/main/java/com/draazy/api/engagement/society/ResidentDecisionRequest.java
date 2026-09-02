package com.draazy.api.engagement.society;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * A reviewer's decision on a residency request (contract {@code ResidentDecision}).
 *
 * <p>Only {@code verified} and {@code rejected} are accepted; putting a request back to
 * {@code pending} is not a decision, and a route that allowed it would let a reviewer erase the
 * record of their own earlier one.
 */
public record ResidentDecisionRequest(
        @NotBlank @Size(max = 16) String status,
        @Size(max = 500) String note) {
}
