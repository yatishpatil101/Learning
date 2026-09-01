package com.punenest.api.engagement.society;

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
 */
public record SocietyProposalResponse(
        UUID id,
        String societySlug,
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
