package com.draazy.api.engagement.notification;

import static org.assertj.core.api.Assertions.assertThatCode;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@DisplayName("Notification scheduled retention")
class NotificationRetentionSchedulingTest {

    @Autowired NotificationRetention retention;

    @Test
    void purgeNowRunsInATransaction() {
        assertThatCode(() -> retention.purgeNow()).doesNotThrowAnyException();
    }
}
