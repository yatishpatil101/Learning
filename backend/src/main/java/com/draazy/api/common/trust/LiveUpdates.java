package com.draazy.api.common.trust;

import java.util.UUID;

/** Tells a user's open tabs, over the stream they already hold, that a count they show is stale. */
public interface LiveUpdates {

    void notificationsChanged(UUID userId);
}
