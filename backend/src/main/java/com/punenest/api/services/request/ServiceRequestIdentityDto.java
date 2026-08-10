package com.punenest.api.services.request;

import java.time.Instant;

/**
 * Contract schema {@code ServiceRequestIdentity} — what the assigned operator reads from
 * {@code GET /service-requests/{id}/identities} (D151).
 *
 * <p><strong>The raw numbers are on this record, and that is the point of the endpoint.</strong> A
 * masked PAN cannot be typed into a Leave &amp; License. Everything that makes that safe is
 * elsewhere: the route is guarded on the request's assignee rather than on a role, the read is
 * recorded in {@code audit_log}, and the numbers are blanked when the matter closes. This shape is
 * never reached from a list endpoint and is not a field on {@link ServiceRequestDto}.
 *
 * <p>{@code pan} and {@code aadhaar} are null in two different situations and the reader has to be
 * able to tell them apart, which is what {@code purgedAt} is for: null numbers with a null
 * {@code purgedAt} mean the customer left that field empty, and null numbers with a timestamp mean
 * the matter is closed and they have been discarded. Without it, a completed request would look
 * identical to a customer who never filled the form.
 */
public record ServiceRequestIdentityDto(
        String partyRole,
        int partyIndex,
        String partyName,
        String pan,
        String aadhaar,
        Instant purgedAt) {

    static ServiceRequestIdentityDto of(ServiceRequestIdentity row) {
        return new ServiceRequestIdentityDto(row.getPartyRole(), row.getPartyIndex(),
                row.getPartyName(), row.getPan(), row.getAadhaar(), row.getPurgedAt());
    }
}
