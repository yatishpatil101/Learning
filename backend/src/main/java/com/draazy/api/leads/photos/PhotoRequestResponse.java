package com.draazy.api.leads.photos;

import java.time.Instant;

/** Requester mobile is always masked with no reveal path: a photo request is gated on sign-in alone, so a real
 * number here would let anyone harvest buyer contacts without passing the contact gate. */
public record PhotoRequestResponse(
        String id,
        String propertyId,
        String propertySlug,
        String propertyTitle,
        Requester requester,
        String status,
        Instant createdAt) {

    public record Requester(String name, String mobile) {
    }
}
