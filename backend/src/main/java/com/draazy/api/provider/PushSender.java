package com.draazy.api.provider;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

public interface PushSender {

    void send(String endpoint, String p256dh, String auth, PushPayloads.Payload payload);
}

@Component
class LoggingPushSender implements PushSender {

    private static final Logger LOG = LoggerFactory.getLogger(LoggingPushSender.class);

    @Override
    public void send(String endpoint, String p256dh, String auth, PushPayloads.Payload payload) {
        LOG.info("Dev push notification queued conversationId={}", conversationId(payload));
    }

    private static String conversationId(PushPayloads.Payload payload) {
        return payload.url().startsWith("/messages?c=")
                ? payload.url().substring("/messages?c=".length())
                : "unknown";
    }
}
