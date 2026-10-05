package com.draazy.api.common.trust;

import java.util.UUID;

public interface PushNotifier {

    void messageReceived(UUID userId, UUID conversationId);
}
