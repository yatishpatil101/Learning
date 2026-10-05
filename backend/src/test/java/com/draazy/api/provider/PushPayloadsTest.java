package com.draazy.api.provider;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class PushPayloadsTest {

    @Test
    void messageReceivedContainsNoPersonalData() {
        PushPayloads.Payload payload = PushPayloads.messageReceived(
                UUID.fromString("11111111-1111-1111-1111-111111111111"));

        assertThat(payload.title()).isEqualTo("Draazy");
        assertThat(payload.body()).isEqualTo("You have a new message");
        assertThat(payload.url()).isEqualTo("/messages?c=11111111-1111-1111-1111-111111111111");
        assertThat(payload.title() + payload.body() + payload.url())
                .doesNotContain("Asha", "9876543210", "asha@example.com", "2BHK", "hello");
    }
}
