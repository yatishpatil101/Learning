package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** A host's own room as the dashboard and the board's "your posts" strip draw it. The full
 * {@link FlatmateRoomDto} stays on the detail read, where the edit form needs it. */
public record FlatmateRoomCard(
        UUID id,
        String title,
        UUID propertyId,
        String society,
        String flatType,
        String locality,
        List<String> localities,
        Long budget,
        int shareMax,
        int occupants,
        String cover,
        String modStatus,
        String status,
        Instant createdAt) {
}
