package com.punenest.api.leads.contact;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code requestContact} (contract {@code ContactRequestCreate}).
 *
 * <p><strong>What is deliberately absent:</strong> any identifier of the requester. The mock provider
 * keys a request by {@code ownerMobile + propId} and carries a {@code buyerMobile}; the server takes
 * the requester from the JWT and the owner from {@code properties.owner_id}. Accepting either from
 * the client would let a caller open a request in someone else's name.
 *
 * @param propertyId the listing to ask about — a UUID id or a slug, matching what the property detail
 *                   endpoint accepts, so the client can pass whatever it already holds
 * @param message    optional free-text note shown to the owner in their inbox. Capped at 1000
 *                   characters (mirrored into the spec): the column is unbounded {@code text}, and an
 *                   authenticated caller should not be able to push megabytes into an owner's inbox
 *                   payload
 */
public record ContactRequestCreate(
        @NotBlank String propertyId,
        @Size(max = 1000) String message) {
}
