package com.draazy.api.provider;

import java.util.UUID;

public final class PushPayloads {

    private PushPayloads() {
    }

    public static Payload messageReceived(UUID conversationId) {
        return new Payload("Draazy", "You have a new message", "/messages?c=" + conversationId);
    }

    public record Payload(String title, String body, String url) {
    }
}
