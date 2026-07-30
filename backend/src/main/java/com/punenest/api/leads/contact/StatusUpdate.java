package com.punenest.api.leads.contact;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code respondContactRequest} (contract {@code StatusUpdate}) — the owner approving or
 * declining one incoming request.
 *
 * @param status the target state; constrained to {@link ContactRequestStatuses#RESPONSE_PATTERN}
 *               ({@code approved|declined}) because {@code pending} is not a decision and the
 *               contract offers no un-decide. A wider {@code String} here would push the check into
 *               the service and cost the caller a 500-shaped surprise instead of a 422
 * @param note   optional reason, recorded for the owner's own reference; never shown to the requester
 *               at MVP (there is no column for it — see the slice-3 reconciliation log). Capped at 500
 *               characters, mirrored into the spec
 */
public record StatusUpdate(
        @NotBlank @Pattern(regexp = ContactRequestStatuses.RESPONSE_PATTERN) String status,
        @Size(max = 500) String note) {
}
