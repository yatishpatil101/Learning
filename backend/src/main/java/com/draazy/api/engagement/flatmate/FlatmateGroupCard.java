package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** A host's own group as the dashboard, the board's "your posts" strip and the group-apply picker draw it. The full
 * {@link FlatmateGroupDto} stays on the detail read, where the edit form needs it. */
public record FlatmateGroupCard(
        UUID id,
        String title,
        String locality,
        List<String> localities,
        Long rent,
        int seatsTotal,
        int seatsOpen,
        int memberCount,
        UUID propertyId,
        String modStatus,
        Instant createdAt) {
}
