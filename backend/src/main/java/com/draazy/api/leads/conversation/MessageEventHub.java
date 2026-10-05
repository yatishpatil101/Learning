package com.draazy.api.leads.conversation;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Component
public class MessageEventHub {

    static final long STREAM_TIMEOUT_MS = Duration.ofMinutes(5).toMillis();

    private final Map<UUID, Set<Client>> clients = new ConcurrentHashMap<>();
    private final ScheduledExecutorService heartbeats = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "message-sse-heartbeat");
        t.setDaemon(true);
        return t;
    });

    public MessageEventHub() {
        heartbeats.scheduleAtFixedRate(this::heartbeat, 25, 25, TimeUnit.SECONDS);
    }

    public SseEmitter connect(UUID userId, Runnable onEmpty) {
        SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
        Client client = new Client(userId, emitter);
        clients.compute(userId, (ignored, existing) -> {
            Set<Client> userClients = existing == null ? ConcurrentHashMap.newKeySet() : existing;
            userClients.add(client);
            return userClients;
        });
        Runnable remove = () -> remove(client, onEmpty);
        emitter.onCompletion(remove);
        emitter.onTimeout(remove);
        emitter.onError(ignored -> remove.run());
        return emitter;
    }

    public boolean isOnline(UUID userId) {
        Set<Client> userClients = clients.get(userId);
        return userClients != null && !userClients.isEmpty();
    }

    public void publish(UUID userId, String event, Object data) {
        Set<Client> userClients = clients.get(userId);
        if (userClients == null) {
            return;
        }
        for (Client client : userClients) {
            client.send(event, data);
        }
    }

    @PreDestroy
    void stop() {
        heartbeats.shutdownNow();
    }

    private void heartbeat() {
        clients.values().forEach(set -> set.forEach(Client::heartbeat));
    }

    private void remove(Client client, Runnable onEmpty) {
        boolean[] emptied = {false};
        clients.computeIfPresent(client.userId(), (ignored, userClients) -> {
            userClients.remove(client);
            emptied[0] = userClients.isEmpty();
            return emptied[0] ? null : userClients;
        });
        if (emptied[0]) {
            onEmpty.run();
        }
    }

    private record Client(UUID userId, SseEmitter emitter) {
        void send(String event, Object data) {
            try {
                synchronized (emitter) {
                    emitter.send(SseEmitter.event().name(event).data(data));
                }
            } catch (IOException | IllegalStateException failed) {
                emitter.complete();
            }
        }

        void heartbeat() {
            try {
                synchronized (emitter) {
                    emitter.send(SseEmitter.event().comment("heartbeat"));
                }
            } catch (IOException | IllegalStateException failed) {
                emitter.complete();
            }
        }
    }
}
