package com.draazy.api.catalog.property;

import java.time.Duration;
import java.time.Instant;

/** Freshness is derived on read because it depends on the clock, not a stored column. */
public enum Freshness {

    ACTIVE,

    AGING,

    STALE,

    DORMANT;

    static final int FRESH_DAYS = 7;
    static final int AGING_DAYS = 14;
    static final int STALE_DAYS = 30;

    /** A missing confirmation falls back to creation so new unconfirmed listings stay visible. */
    public static Freshness of(Instant lastConfirmedAt, Instant createdAt, Instant now) {
        Instant since = lastConfirmedAt != null ? lastConfirmedAt : createdAt;
        if (since == null || now == null) {
            return ACTIVE;
        }
        long days = Math.max(0, Duration.between(since, now).toDays());
        if (days <= FRESH_DAYS) {
            return ACTIVE;
        }
        if (days <= AGING_DAYS) {
            return AGING;
        }
        if (days <= STALE_DAYS) {
            return STALE;
        }
        return DORMANT;
    }

    /** The wire form: lowercase, matching the vocabulary the client already renders. */
    public String wire() {
        return name().toLowerCase();
    }

    public boolean hiddenFromBuyers() {
        return this == DORMANT;
    }

    public boolean needsOwnerAttention() {
        return this != ACTIVE;
    }

    /** Only stale/dormant rows need a human call; aging rows are handled by automation. */
    public boolean unconfirmed() {
        return this == STALE || this == DORMANT;
    }

    /** Keep the query cutoff aligned with {@link #of}, where stale begins after day fourteen. */
    public static Instant unconfirmedBefore(Instant now) {
        return now.minus(Duration.ofDays(AGING_DAYS + 1L));
    }
}
