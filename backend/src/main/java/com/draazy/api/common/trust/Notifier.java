package com.draazy.api.common.trust;

import java.util.UUID;

public interface Notifier {

    void notify(UUID userId, String type, String title, String body, String link);

    default void markRead(UUID userId, String type, String link) {
    }
}
