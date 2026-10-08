package com.draazy.api.catalog.locality;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Place ids that failed verification, remembered so a repeated bad pick never costs another Google call. */
final class RejectedPlaces {

    private final Duration ttl;
    private final Clock clock;
    private final Map<String, Instant> rejectedAt;

    RejectedPlaces(int capacity, Duration ttl, Clock clock) {
        this.ttl = ttl;
        this.clock = clock;
        this.rejectedAt = new LinkedHashMap<>() {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Instant> eldest) {
                return size() > capacity;
            }
        };
    }

    synchronized boolean contains(String placeId) {
        Instant at = rejectedAt.get(placeId);
        if (at == null) {
            return false;
        }
        if (at.plus(ttl).isBefore(clock.instant())) {
            rejectedAt.remove(placeId);
            return false;
        }
        return true;
    }

    synchronized void add(String placeId) {
        rejectedAt.remove(placeId);
        rejectedAt.put(placeId, clock.instant());
    }
}
