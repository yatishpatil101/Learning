package com.draazy.api.engagement.flatmate;

import java.util.UUID;

/** One sent ask as a key: boards and detail pages only ask "did I already ask this, and how did it go". */
public record FlatmateInterestKeyDto(UUID id, String kind, UUID targetId, String status) {
}
