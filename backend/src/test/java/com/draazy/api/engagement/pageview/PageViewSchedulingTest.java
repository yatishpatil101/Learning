package com.draazy.api.engagement.pageview;

import static org.assertj.core.api.Assertions.assertThatCode;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * The two scheduled entry points open their own transactions.
 *
 * <p><strong>Why this class is not {@code @Transactional}.</strong> Every other test in this
 * codebase inherits {@code AbstractApiTest}, which wraps each method in a transaction — so a
 * self-invoked write would find an ambient one to join and pass whether or not the method under
 * test declares anything. Proving a method starts its own transaction requires there to be none to
 * inherit, so this class deliberately omits it. Same shape, and the same reason, as
 * {@code ReferralSignalRetentionSweepTest}.
 *
 * <p><strong>What this is guarding against.</strong> {@code expireNow()} and {@code rollUpNow()}
 * each call a sibling method on {@code this}. A self-invocation never leaves the object, so it
 * never crosses the transactional proxy and an annotation on the inner method applies to nobody:
 * the modifying query then throws {@code No active transaction} on every scheduled tick. That is
 * not hypothetical — {@code ReferralSignalRetention} shipped exactly this bug and its ninety-day
 * expiry never ran once. Both schedulers swallow exceptions to keep their timers alive, so the
 * failure is invisible except in a log nobody opens while the suite is green.
 *
 * <p><strong>Why it asserts "does not throw" rather than row counts.</strong> The defect is
 * structural and fires before any row is considered. On an empty test database both calls match
 * nothing, write nothing and commit nothing, which keeps this compatible with the standing
 * requirement that {@code draazy_test} hold schema and no data. What the operations actually do
 * to the right rows is proved separately, at instants the test chooses, by
 * {@link PageViewRollupTest} and {@link PageViewRetentionTest}.
 */
@SpringBootTest
@DisplayName("Page view scheduled jobs")
class PageViewSchedulingTest {

    @Autowired PageViewRetention retention;
    @Autowired PageViewRollup rollup;

    @Test
    @DisplayName("expireNow() opens its own transaction, so the retention sweep can delete")
    void expireNowRunsInATransaction() {
        assertThatCode(() -> retention.expireNow())
                .as("the sweep calls expireNow() with no ambient transaction; without one of its "
                        + "own the DELETE fails and the ninety-day promise silently never runs")
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("rollUpNow() opens its own transaction, so the hourly job can write aggregates")
    void rollUpNowRunsInATransaction() {
        assertThatCode(() -> rollup.rollUpNow())
                .as("the job calls rollUpNow() with no ambient transaction; without one of its own "
                        + "every tick fails and the analytics charts quietly stop moving")
                .doesNotThrowAnyException();
    }
}
