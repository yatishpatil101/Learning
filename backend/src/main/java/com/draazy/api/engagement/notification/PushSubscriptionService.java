package com.draazy.api.engagement.notification;

import com.draazy.api.common.trust.PushNotifier;
import com.draazy.api.provider.PushPayloads;
import com.draazy.api.provider.PushSender;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PushSubscriptionService implements PushNotifier {

    private static final Logger log = LoggerFactory.getLogger(PushSubscriptionService.class);
    private static final int MAX_PER_USER = 10;

    private final JdbcTemplate jdbc;
    private final PushSender sender;

    public PushSubscriptionService(JdbcTemplate jdbc, PushSender sender) {
        this.jdbc = jdbc;
        this.sender = sender;
    }

    @Transactional
    public void upsert(UUID userId, PushSubscriptionRequest body) {
        jdbc.update("""
                insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)
                values (gen_random_uuid(), ?, ?, ?, ?)
                on conflict (endpoint) do update
                   set user_id = excluded.user_id,
                       p256dh = excluded.p256dh,
                       auth = excluded.auth,
                       created_at = now()
                """, userId, body.endpoint(), body.keys().p256dh(), body.keys().auth());
        jdbc.update("""
                delete from push_subscriptions
                 where user_id = ?
                   and id not in (select id from push_subscriptions where user_id = ?
                                   order by created_at desc limit ?)
                """, userId, userId, MAX_PER_USER);
    }

    @Transactional
    public void delete(UUID userId, String endpoint) {
        jdbc.update("delete from push_subscriptions where user_id = ? and endpoint = ?", userId, endpoint);
    }

    @Override
    public void messageReceived(UUID userId, UUID conversationId) {
        PushPayloads.Payload payload = PushPayloads.messageReceived(conversationId);
        List<Subscription> subscriptions = jdbc.query(
                "select endpoint, p256dh, auth from push_subscriptions where user_id = ?",
                (rs, row) -> new Subscription(rs.getString("endpoint"), rs.getString("p256dh"),
                        rs.getString("auth")),
                userId);
        if (!subscriptions.isEmpty()) {
            Thread.startVirtualThread(() -> deliver(subscriptions, payload));
        }
    }

    void deliver(List<Subscription> subscriptions, PushPayloads.Payload payload) {
        for (Subscription subscription : subscriptions) {
            try {
                if (!sender.send(subscription.endpoint(), subscription.p256dh(), subscription.auth(), payload)) {
                    jdbc.update("delete from push_subscriptions where endpoint = ?", subscription.endpoint());
                }
            } catch (RuntimeException e) {
                log.warn("Push delivery failed", e);
            }
        }
    }

    record Subscription(String endpoint, String p256dh, String auth) {
    }
}
