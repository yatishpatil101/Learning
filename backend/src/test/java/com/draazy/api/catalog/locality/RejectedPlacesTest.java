package com.draazy.api.catalog.locality;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class RejectedPlacesTest {

    private static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");

        @Override public java.time.ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    @Test
    void remembersAnIdUntilTheTtlPasses() {
        MutableClock clock = new MutableClock();
        RejectedPlaces rejected = new RejectedPlaces(10, Duration.ofHours(24), clock);

        rejected.add("p1");
        assertThat(rejected.contains("p1")).isTrue();

        clock.now = clock.now.plus(Duration.ofHours(25));
        assertThat(rejected.contains("p1")).isFalse();
    }

    @Test
    void staysWithinItsCapacityByDroppingTheOldest() {
        RejectedPlaces rejected = new RejectedPlaces(2, Duration.ofHours(24), new MutableClock());

        rejected.add("a");
        rejected.add("b");
        rejected.add("c");

        assertThat(rejected.contains("a")).isFalse();
        assertThat(rejected.contains("b")).isTrue();
        assertThat(rejected.contains("c")).isTrue();
    }
}
