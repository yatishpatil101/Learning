package com.draazy.api.engagement.notification;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.PushPayloads;
import com.draazy.api.provider.PushSender;
import com.draazy.api.support.AbstractApiTest;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("Push delivery prunes dead subscriptions")
class PushSubscriptionDeliveryTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private UUID userWithSubscriptions(String... endpoints) {
        User u = new User("9810200001", "owner");
        u.setName("Push User");
        u.setMobileVerified(true);
        UUID id = users.saveAndFlush(u).getId();
        for (String endpoint : endpoints) {
            jdbc.update("insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)"
                    + " values (gen_random_uuid(), ?, ?, 'k', 'a')", id, endpoint);
        }
        return id;
    }

    private List<String> endpointsOf(UUID user) {
        return jdbc.queryForList("select endpoint from push_subscriptions where user_id = ? order by endpoint",
                String.class, user);
    }

    private List<PushSubscriptionService.Subscription> all(UUID user) {
        return endpointsOf(user).stream().map(e -> new PushSubscriptionService.Subscription(e, "k", "a")).toList();
    }

    @Test
    @DisplayName("a user keeps only their ten newest subscriptions")
    void subscriptionsAreCapped() {
        UUID user = userWithSubscriptions();
        for (int hours = 1; hours <= 12; hours++) {
            jdbc.update("insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)"
                    + " values (gen_random_uuid(), ?, ?, 'k', 'a', now() - (? * interval '1 hour'))",
                    user, "https://push.example/" + hours, hours);
        }

        new PushSubscriptionService(jdbc, (e, p, a, payload) -> true).upsert(user,
                new PushSubscriptionRequest("https://push.example/new", new PushSubscriptionRequest.Keys("k", "a")));

        assertThat(endpointsOf(user)).hasSize(10).contains("https://push.example/new", "https://push.example/9")
                .doesNotContain("https://push.example/10", "https://push.example/11", "https://push.example/12");
    }

    @Test
    @DisplayName("only the subscription the push service reports gone is deleted")
    void goneSubscriptionIsDeleted() {
        UUID user = userWithSubscriptions("https://push.example/live", "https://push.example/gone");
        PushSender sender = (endpoint, p256dh, auth, payload) -> !endpoint.endsWith("/gone");

        new PushSubscriptionService(jdbc, sender).deliver(all(user), PushPayloads.messageReceived(UUID.randomUUID()));

        assertThat(endpointsOf(user)).containsExactly("https://push.example/live");
    }

    @Test
    @DisplayName("a sender that throws neither deletes anything nor stops the remaining deliveries")
    void failureKeepsSubscriptionsAndContinues() {
        UUID user = userWithSubscriptions("https://push.example/a", "https://push.example/b");
        PushSender sender = (endpoint, p256dh, auth, payload) -> {
            if (endpoint.endsWith("/a")) {
                throw new IllegalStateException("boom");
            }
            return false;
        };

        new PushSubscriptionService(jdbc, sender).deliver(all(user), PushPayloads.messageReceived(UUID.randomUUID()));

        assertThat(endpointsOf(user)).containsExactly("https://push.example/a");
    }
}
