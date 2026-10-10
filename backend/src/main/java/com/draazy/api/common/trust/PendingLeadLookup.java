package com.draazy.api.common.trust;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/** Counted by {@code leads} so {@code catalog} can draw an owner's lead chip without importing it. */
public interface PendingLeadLookup {

    /** Open contact requests per property; a property with none is absent. */
    Map<UUID, Integer> pendingFor(Collection<UUID> propertyIds);
}
