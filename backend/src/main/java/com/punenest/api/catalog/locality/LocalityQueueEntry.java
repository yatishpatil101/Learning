package com.punenest.api.catalog.locality;

import java.time.Instant;

/**
 * One listing the locality resolver could not place — a row of the curation queue.
 *
 * <p><strong>This carries no owner and no contact data, and that is a decision rather than an
 * oversight.</strong> Clearing this queue is a geography question: the curator reads the free text
 * the owner typed, looks at where the pin fell, and picks the area it belongs to. A name or a mobile
 * number answers none of that, and putting them here would make a locality console a second place
 * the marketplace's seller list can be read from — one gated on {@code properties:read}, which a
 * curation desk plausibly holds, rather than on the enquiry permissions that guard contact data
 * everywhere else.
 *
 * @param id           the listing's id, and what the assignment route is addressed by
 * @param title        enough for a curator to recognise the listing, no more
 * @param locality     the free text the owner typed — the thing that failed to resolve, and the
 *                     single most useful field on the row
 * @param city         which city's locality table the curator should be picking from
 * @param lat          where the listing's pin fell; {@code null} when the owner gave no location,
 *                     which is itself the likeliest reason the resolver gave up
 * @param lng          see {@code lat}
 * @param status       {@code pending} means a moderator is about to be stopped from approving this;
 *                     {@code approved} means it is already live and invisible to every locality
 *                     surface, which is the more urgent repair
 * @param localitySlug {@code null} for every row in the queue, and the assigned key in the response
 *                     to an assignment — so the reply states what changed rather than only that
 *                     something did
 * @param createdAt    how long this listing has been waiting
 */
public record LocalityQueueEntry(
        String id,
        String title,
        String locality,
        String city,
        Double lat,
        Double lng,
        String status,
        String localitySlug,
        Instant createdAt) {
}
