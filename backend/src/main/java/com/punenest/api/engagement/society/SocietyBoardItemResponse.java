package com.punenest.api.engagement.society;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

/**
 * One noticeboard item.
 *
 * <p>{@code canRemove} is computed for the calling viewer rather than left to the client to work
 * out from {@code authorName}. The rule is "the author, the committee, or staff", and a client
 * deriving it from a display name would get it wrong the moment two residents share one — and would
 * then draw a delete button that 403s, which reads as a broken page rather than a rule.
 */
public record SocietyBoardItemResponse(
        UUID id,
        String societySlug,
        String kind,
        String title,
        String body,
        String category,
        LocalDate eventDate,
        LocalTime eventTime,
        String authorName,
        boolean authorIsResident,
        boolean canRemove,
        Instant createdAt) {
}
