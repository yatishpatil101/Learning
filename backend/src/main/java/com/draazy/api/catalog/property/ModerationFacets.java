package com.draazy.api.catalog.property;

import com.draazy.api.common.error.BadRequestException;
import java.util.Set;

/** Moderation facets stay separate because the public catalogue must not express these axes. */
public record ModerationFacets(
        Boolean archived,
        Boolean recheck,
        Boolean featured,
        Boolean postedByAdmin,
        Boolean unconfirmed,
        String progress,
        Boolean badge) {

    public static final Set<String> PROGRESS = Set.of("awaiting_confirmation", "ready", "in_review", "needs_info");

    public static final ModerationFacets NONE = new ModerationFacets(null, null, null, null, null, null, null);

    public ModerationFacets {
        if (progress != null && !PROGRESS.contains(progress)) {
            throw new BadRequestException("Unknown progress filter: " + progress);
        }
    }

    /** True when no axis is set, so the caller wants the whole table. */
    public boolean isEmpty() {
        return archived == null && recheck == null && featured == null
                && postedByAdmin == null && unconfirmed == null && progress == null && badge == null;
    }
}
