package com.draazy.api.catalog.property;

import java.util.List;
import java.util.Set;

/** Status strings are both DB values and API surface, so changing one is a migration. */
public final class PropertyStatus {

    private PropertyStatus() {
    }

    public static final String PENDING = "pending";

    /** Live and publicly visible. Set by moderation only — never by an owner's own edit. */
    public static final String APPROVED = "approved";

    public static final String PAUSED = "paused";

    public static final String REJECTED = "rejected";

    /** Flagged for review (e.g. a user report). Not publicly visible. */
    public static final String FLAGGED = "flagged";

    /** Soft-deleted by the owner. Retained for audit; never hard-deleted. */
    public static final String ARCHIVED = "archived";

    /** Never set by an owner's own edit. */
    public static final String SOLD = "sold";

    public static final String RENTED = "rented";

    public static final Set<String> DIRECTLY_REACHABLE = Set.of(APPROVED, PAUSED, SOLD, RENTED);

    public static final List<String> OCCUPYING_DUPLICATE_STATUSES = List.of(PENDING, APPROVED, PAUSED);

    /** Rejected rows do not occupy a slot; otherwise one rejection would exhaust the free tier. */
    public static final Set<String> OCCUPIES_LISTING_SLOT =
            Set.of(PENDING, APPROVED, PAUSED, FLAGGED, SOLD, RENTED);
}
