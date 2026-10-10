package com.draazy.api.provider;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Component;

public interface PushSender {

    /** Returns false only when the push service says the subscription is gone (or unusable), so it can be deleted. */
    boolean send(String endpoint, String p256dh, String auth, PushPayloads.Payload payload);
}

/** Wired while no VAPID private key is configured. */
@Component
@ConditionalOnExpression("'${draazy.providers.push.vapid-private-key:}'.isBlank()")
class LoggingPushSender implements PushSender {

    private static final Logger LOG = LoggerFactory.getLogger(LoggingPushSender.class);

    @Override
    public boolean send(String endpoint, String p256dh, String auth, PushPayloads.Payload payload) {
        LOG.info("Dev push notification queued conversationId={}", conversationId(payload));
        return true;
    }

    private static String conversationId(PushPayloads.Payload payload) {
        return payload.url().startsWith("/messages?c=")
                ? payload.url().substring("/messages?c=".length())
                : "unknown";
    }
}
