package com.draazy.api.leads.conversation;

import com.draazy.api.common.trust.FlatmateGroupRoster;
import com.draazy.api.common.trust.LiveUpdates;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Component
public class MessageEvents implements LiveUpdates {

    private static final Duration ACTIVE_TOUCH_INTERVAL = Duration.ofMinutes(1);
    private static final Duration TYPING_REPEAT_WINDOW = Duration.ofSeconds(2);

    private final MessageEventHub hub;
    private final ConversationRepository conversations;
    private final UserRepository users;
    private final FlatmateGroupRoster roster;
    private final TransactionTemplate transactions;
    private final Map<String, Instant> typing = new ConcurrentHashMap<>();

    public MessageEvents(MessageEventHub hub, ConversationRepository conversations,
            UserRepository users, FlatmateGroupRoster roster,
            PlatformTransactionManager transactionManager) {
        this.hub = hub;
        this.conversations = conversations;
        this.users = users;
        this.roster = roster;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    public SseEmitter stream(UUID userId) {
        boolean wasOnline = hub.isOnline(userId);
        SseEmitter emitter = hub.connect(userId, () -> streamClosed(userId));
        touch(userId);
        if (!wasOnline) {
            presenceChanged(userId);
        }
        return emitter;
    }

    public boolean isOnline(UUID userId) {
        return hub.isOnline(userId);
    }

    public void messageCreated(Conversation conversation, UUID authorId) {
        afterCommit(() -> {
            Event event = new Event(conversation.getId().toString());
            participants(conversation).forEach(userId -> hub.publish(userId, "message", event));
        });
    }

    @Override
    public void notificationsChanged(UUID userId) {
        afterCommit(() -> hub.publish(userId, "notification", Map.of()));
    }

    public void read(Conversation conversation, UUID readerId) {
        if (conversation.isGroup()) {
            return;
        }
        UUID other = conversation.other(readerId);
        if (other != null && !conversations.blockedEitherWay(readerId, other) && shareReadReceipts(readerId, other)) {
            afterCommit(() -> hub.publish(other, "read", new Event(conversation.getId().toString())));
        }
    }

    public void typing(Conversation conversation, UUID authorId) {
        Instant now = Instant.now();
        String key = conversation.getId() + ":" + authorId;
        Instant previous = typing.put(key, now);
        if (previous != null && previous.plus(TYPING_REPEAT_WINDOW).isAfter(now)) {
            return;
        }
        Event event = new Event(conversation.getId().toString());
        participants(conversation).stream()
                .filter(userId -> !userId.equals(authorId))
                .forEach(userId -> hub.publish(userId, "typing", event));
    }

    public void afterCommit(Runnable callback) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            callback.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                callback.run();
            }
        });
    }

    @Scheduled(fixedDelayString = "PT25S")
    void purgeTyping() {
        Instant cutoff = Instant.now().minus(TYPING_REPEAT_WINDOW);
        typing.entrySet().removeIf(entry -> entry.getValue().isBefore(cutoff));
    }

    private void streamClosed(UUID userId) {
        touch(userId);
        presenceChanged(userId);
    }

    private void presenceChanged(UUID userId) {
        transactions.executeWithoutResult(tx -> {
            User user = users.findById(userId).orElse(null);
            if (user == null || !user.isShareActivityStatus()) {
                return;
            }
            for (Conversation conversation : conversations.directFor(userId)) {
                UUID otherId = conversation.other(userId);
                if (conversations.blockedEitherWay(userId, otherId)) {
                    continue;
                }
                users.findById(otherId)
                        .filter(User::isShareActivityStatus)
                        .ifPresent(other -> hub.publish(otherId, "presence",
                                new Event(conversation.getId().toString())));
            }
        });
    }

    private void touch(UUID userId) {
        transactions.executeWithoutResult(tx -> {
            Instant now = Instant.now();
            users.touchLastActive(userId, now, now.minus(ACTIVE_TOUCH_INTERVAL));
        });
    }

    private boolean shareReadReceipts(UUID one, UUID other) {
        Map<UUID, User> loaded = users.findAllById(Set.of(one, other)).stream()
                .collect(java.util.stream.Collectors.toMap(User::getId, u -> u));
        User a = loaded.get(one);
        User b = loaded.get(other);
        return a != null && b != null && a.isShareReadReceipts() && b.isShareReadReceipts();
    }

    private Collection<UUID> participants(Conversation conversation) {
        if (conversation.isGroup()) {
            return roster.memberIds(conversation.getFlatmateGroupId());
        }
        return Set.of(conversation.getUserAId(), conversation.getUserBId());
    }

    public record Event(String conversationId) {
    }
}
