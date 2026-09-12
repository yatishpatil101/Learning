package com.draazy.api.identity.user.erasure;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * {@code PATCH /admin/erasure-requests/{id}} body.
 *
 * @param decision {@code execute} or {@code reject} — see
 *     {@code ErasureService.ErasureDecisions}. There is no default: an admin deciding somebody's
 *     erasure by omitting a field is not a decision anybody should be able to make by accident.
 * @param note     required when rejecting, optional when executing. A refusal the subject cannot
 *     understand is a refusal they cannot act on.
 */
public record ErasureDecisionRequest(
        @NotBlank String decision,
        @Size(max = 2000) String note) {
}
