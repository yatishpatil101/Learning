package com.draazy.api.engagement.notification;

import com.draazy.api.common.trust.PushNotifier;
import com.draazy.api.provider.PushPayloads;
import com.draazy.api.provider.PushSender;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PushSubscriptionService implements PushNotifier {

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
    }

    @Transactional
    public void delete(UUID userId, String endpoint) {
        jdbc.update("delete from push_subscriptions where user_id = ? and endpoint = ?", userId, endpoint);
    }

    @Override
    @Transactional(readOnly = true)
    public void messageReceived(UUID userId, UUID conversationId) {
        PushPayloads.Payload payload = PushPayloads.messageReceived(conversationId);
        jdbc.query("""
                select endpoint, p256dh, auth
                  from push_subscriptions
                 where user_id = ?
                """, rs -> {
                    sender.send(rs.getString("endpoint"), rs.getString("p256dh"),
                            rs.getString("auth"), payload);
                }, userId);
    }
}
