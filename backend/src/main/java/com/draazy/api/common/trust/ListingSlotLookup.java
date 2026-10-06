package com.draazy.api.common.trust;

import java.util.UUID;

/** Counted by {@code catalog} so {@code billing} can report it without importing a feature. */
public interface ListingSlotLookup {

    long listingSlotsHeld(UUID userId);
}
