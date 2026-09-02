package com.draazy.api.common.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Turns on Spring's scheduler (D57) — the platform's first background timer.
 *
 * <p>Kept as its own class rather than an annotation on the application class so that the fact the
 * platform now runs work on a clock is discoverable: "what runs without a request?" is answered by
 * finding the {@code @Scheduled} methods this enables, and a reader who does not know one exists
 * would never think to look at {@code DraazyApiApplication} for it.
 *
 * <p><strong>Scheduled work is not gated here.</strong> Each job decides its own conditions — see
 * {@code SubscriptionSweep}, which is disabled in the test run so no timer fires while the suite is
 * asserting on the same rows. Enabling the infrastructure is safe on its own: with no job
 * registered, this does nothing but create an idle thread pool.
 */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
