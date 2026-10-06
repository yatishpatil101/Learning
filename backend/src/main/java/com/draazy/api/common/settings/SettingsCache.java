package com.draazy.api.common.settings;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Kill switches and the permission allow-list never come through here: they must bite on the next request. */
@Component
public class SettingsCache {

    private final SettingRepository settings;
    private final long ttlMillis;
    private final Map<String, Entry> entries = new ConcurrentHashMap<>();
    // Bumped on eviction, so a read that began before a write cannot cache the stale value after it.
    private final AtomicLong generation = new AtomicLong();

    public SettingsCache(SettingRepository settings,
            @Value("${draazy.cache.settings.ttl:30s}") Duration ttl) {
        this.settings = settings;
        this.ttlMillis = ttl.toMillis();
    }

    /** The stored JSON for {@code key}, or empty when there is no row. */
    public Optional<String> value(String key) {
        if (ttlMillis <= 0) {
            return read(key);
        }
        long now = System.currentTimeMillis();
        Entry hit = entries.get(key);
        if (hit != null && hit.expiresAt() > now) {
            return hit.value();
        }
        long seen = generation.get();
        Optional<String> value = read(key);
        Entry entry = new Entry(value, now + ttlMillis);
        entries.put(key, entry);
        if (generation.get() != seen) {
            entries.remove(key, entry);
        }
        return value;
    }

    /** Drops every entry once the current transaction commits, or now outside one. */
    public void evictAfterCommit() {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            evict();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                evict();
            }
        });
    }

    private void evict() {
        generation.incrementAndGet();
        entries.clear();
    }

    private Optional<String> read(String key) {
        return settings.findById(key).map(Setting::getValue);
    }

    private record Entry(Optional<String> value, long expiresAt) {
    }
}
