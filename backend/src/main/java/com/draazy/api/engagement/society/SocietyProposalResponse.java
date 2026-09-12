package com.draazy.api.engagement.society;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A community proposal as published back.
 *
 * <p>Flat, with every kind's fields present and the irrelevant ones null, because the ops queue
 * renders one table across all three kinds and a nested per-kind payload would make that table
 * branch on a discriminator before it can read a column.
 *
 * <p>{@code inviteUrl} is <strong>withheld from anyone who is not a verified resident of this
 * society or staff</strong>, approved or not. The invite is a key to a private resident space; a
 * non-resident is told a group exists and nothing more. That gating happens in the service, so
 * every caller inherits it rather than each one remembering.
 *
 * @param authorName      display name, never a mobile — the queue is read by operators, but so is
 *                        the author's own pending banner
 * @param authorIsResident recomputed on every read, never stored
 * @param decidedByName   the operator who decided, null while pending
 * @param societyName     the building this proposal is about, resolved from the catalogue.
 *                        Denormalised deliberately: the ops queue spans societies and renders one
 *                        row per proposal, so without it the console has to hold the whole society
 *                        catalogue in the browser purely to turn a slug into a name — which is
 *                        exactly what it used to do, from a bundled static file that knew nothing
 *                        about community-minted rows. A proposal against a society a member created
 *                        last week resolved to nothing, and the queue printed a slug where every
 *                        neighbouring row had a name. Null only if the society was deleted out from
 *                        under the proposal, which the foreign key does not allow.
 * @param localitySlug    the same, for the locality column beside it
 */
public record SocietyProposalResponse(
        UUID id,
        String societySlug,
        String societyName,
        String localitySlug,
        String kind,
        String status,
        String builder,
        Integer buildYear,
        Integer towers,
        Integer units,
        BigDecimal maintenancePerSqft,
        List<String> amenities,
        String inviteUrl,
        Double lat,
        Double lng,
        String placeId,
        String label,
        String authorName,
        boolean authorIsResident,
        String decidedByName,
        Instant decidedAt,
        Instant createdAt) {
}
