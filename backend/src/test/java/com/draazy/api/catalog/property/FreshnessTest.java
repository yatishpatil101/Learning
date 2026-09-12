package com.draazy.api.catalog.property;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Pins {@link Freshness#unconfirmedBefore} to {@link Freshness#of}.
 *
 * <p>These two express the same idea in two places that cannot see each other: {@code of} classifies
 * a listing the browser is about to render, and {@code unconfirmedBefore} produces the instant the
 * moderation search compares against in SQL. Nothing in the type system stops the pair drifting, and
 * the drift would be invisible — the desk's "unconfirmed" queue would simply contain a day's worth
 * of listings that are still {@code AGING}, or omit a day's worth that are already {@code STALE},
 * and every row in it would look plausible. So the boundary is asserted from both sides.
 *
 * <p>The off-by-one is real and not hypothetical: {@code of} floors the elapsed duration before
 * comparing, so {@code STALE} does not begin at {@code AGING_DAYS} but a full day later. A
 * hand-written {@code now() - interval '14 days'} in the specification would have been wrong from
 * the moment it was typed.
 */
class FreshnessTest {

    private static final Instant NOW = Instant.parse("2026-03-01T12:00:00Z");

    @Test
    @DisplayName("the SQL cutoff is unconfirmed, and one second later is not")
    void cutoffAgreesWithClassifier() {
        Instant cutoff = Freshness.unconfirmedBefore(NOW);

        assertThat(Freshness.of(cutoff, null, NOW).unconfirmed())
                .as("a listing confirmed exactly at the cutoff is one the desk should chase")
                .isTrue();
        assertThat(Freshness.of(cutoff.plusSeconds(1), null, NOW).unconfirmed())
                .as("one second inside the boundary is still AGING — an automated nudge, not a call")
                .isFalse();
    }

    @Test
    @DisplayName("the cutoff sits a day past AGING_DAYS, because of() floors the duration")
    void cutoffIsADayPastTheNominalThreshold() {
        // Stated as a literal so that moving AGING_DAYS without re-reading unconfirmedBefore's
        // reasoning fails here rather than in a queue nobody is measuring.
        assertThat(Duration.between(Freshness.unconfirmedBefore(NOW), NOW))
                .isEqualTo(Duration.ofDays(Freshness.AGING_DAYS + 1L));

        Instant exactlyAgingDays = NOW.minus(Duration.ofDays(Freshness.AGING_DAYS));
        assertThat(Freshness.of(exactlyAgingDays, null, NOW)).isEqualTo(Freshness.AGING);
    }

    @Test
    @DisplayName("unconfirmed() is STALE or DORMANT — never AGING, which a cron job already handles")
    void unconfirmedExcludesAging() {
        assertThat(Freshness.ACTIVE.unconfirmed()).isFalse();
        assertThat(Freshness.AGING.unconfirmed()).isFalse();
        assertThat(Freshness.STALE.unconfirmed()).isTrue();
        assertThat(Freshness.DORMANT.unconfirmed()).isTrue();
    }

    @Test
    @DisplayName("a listing nobody ever confirmed falls back to when it was posted")
    void fallsBackToCreatedAt() {
        Instant longAgo = NOW.minus(Duration.ofDays(90));

        assertThat(Freshness.of(null, longAgo, NOW).unconfirmed())
                .as("never confirmed and posted three months ago is exactly who the desk chases")
                .isTrue();
        assertThat(Freshness.of(null, NOW.minus(Duration.ofDays(1)), NOW).unconfirmed())
                .as("posting is itself an assertion of availability, so a fresh post is not stale")
                .isFalse();
    }
}
