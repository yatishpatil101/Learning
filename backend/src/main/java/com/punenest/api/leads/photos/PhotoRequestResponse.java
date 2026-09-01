package com.punenest.api.leads.photos;

import java.time.Instant;

/**
 * One photo request as the listing owner sees it.
 *
 * <p><strong>The requester's mobile is always masked, with no reveal path at all</strong> — unlike
 * {@code ContactRequestResponse}, which carries a second raw {@code contact} once the owner approves.
 * That asymmetry is the point of the whole domain. A photo request is gated on sign-in alone, with
 * no L2 badge and no owner consent, precisely because it moves no PII; emitting the buyer's real
 * number here would turn the cheapest endpoint on the platform into a way to harvest buyer contacts
 * without ever passing the contact gate. If a reveal is ever wanted, it belongs behind the gate that
 * already exists, not behind this one.
 *
 * @param propertySlug  the routable token. Emitted alongside the UUID rather than instead of it
 *                      because the owner's inbox does both things: it deep-links to
 *                      {@code /list-property?edit=<slug>} and it resolves rows against ids. Folding
 *                      the two into one {@code propertyId} field is how the contact contract ended up
 *                      accepting "a UUID or a slug" at every call site.
 * @param propertyTitle denormalised onto the response so the owner's inbox renders and deep-links in
 *                      one round trip. The client used to carry a {@code propLabel} it had captured
 *                      at request time, which went stale the moment the owner renamed the listing.
 * @param status        one of {@link PhotoRequestStatuses}
 * @param resolvedAt    {@code null} while pending
 */
public record PhotoRequestResponse(
        String id,
        String propertyId,
        String propertySlug,
        String propertyTitle,
        Requester requester,
        String status,
        Instant createdAt,
        Instant resolvedAt) {

    /**
     * Who asked.
     *
     * @param mobile <strong>always masked</strong> ({@code 98XXXXX210}) — see the type note above
     */
    public record Requester(String name, String mobile) {
    }
}
