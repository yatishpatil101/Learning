package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.UUID;

/** A card on the moderation desk: the queue item without the photo URLs (a count is all a card
 * shows) and without the author's id. The popup reads the full {@link FlatmateModerationQueueDto}. */
public record FlatmateModerationRow(
        UUID id,
        String kind,
        String modStatus,
        String authorName,
        String headline,
        String locality,
        String freeText,
        int photoCount,
        String recheckReason,
        Instant recheckRequestedAt,
        Instant createdAt) {

    static FlatmateModerationRow of(FlatmateModerationQueueDto item) {
        return new FlatmateModerationRow(item.id(), item.kind(), item.modStatus(), item.authorName(),
                item.headline(), item.locality(), item.freeText(), item.photos().size(),
                item.recheckReason(), item.recheckRequestedAt(), item.createdAt());
    }
}