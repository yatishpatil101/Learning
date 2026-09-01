package com.punenest.api.engagement.society;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * An operator's decision on a community proposal.
 *
 * <p>Its own record rather than a reuse of {@link SocietyProposalRequest} for the same reason the
 * claim decision is separate: a decision has one field the proposal does not have and none of the
 * fields the proposal does, and a request record that means two different things depending on which
 * handler received it is a record whose validation annotations cannot be right for both.
 *
 * @param status {@code approved} or {@code rejected}
 */
public record SocietyProposalDecisionRequest(
        @NotBlank @Size(max = 16) String status) {
}
