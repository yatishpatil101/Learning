package com.punenest.api.moderation.user;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * One line in a person's activity history, as the console renders it.
 *
 * <p><strong>Deliberately not a sentence.</strong> The client-side version this replaces baked the
 * wording into the join ("Requested site visit", "Booked: Deep clean"), which meant the server would
 * have had to own English — and the console is translated. So the wire carries the two facts the
 * screen needs to word it, {@code kind} and {@code status}, and the label is whatever the source row
 * already calls itself: a property title, a service type, an audit action. Nothing here needs
 * translating that was not already translated.
 *
 * @param kind     {@code account | enquiry | visit | service | listing | moderation} — chooses the
 *                 icon, the colour and the phrasing on the client
 * @param entityId the id of the thing that happened, so the console can link to it. For
 *                 {@code account} and {@code moderation} this is the user's own id
 * @param at       when it happened. For a visit this is when it was booked, not the slot it was
 *                 booked for — see {@code UserTimelineRepository}
 * @param label    the source row's own name for itself: a property title, a service type, an audit
 *                 action, or the person's role on the {@code account} line
 * @param status   the source row's status where it has one, absent where it does not (audit rows).
 *                 Absent rather than empty so the client can tell "no status" from "blank status"
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UserTimelineEntry(
        String kind,
        String entityId,
        Instant at,
        String label,
        String status) {
}
