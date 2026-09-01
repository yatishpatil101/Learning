package com.punenest.api.billing;

import static org.assertj.core.api.Assertions.assertThatCode;

import com.punenest.api.billing.referral.ReferralSignalRetention;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * The path the scheduled sweep actually takes can open a transaction.
 *
 * <p><strong>Why this is a separate class rather than a case in {@code ReferralQualificationTest}.</strong>
 * That class extends {@code AbstractApiTest}, which is {@code @Transactional}: a transaction is
 * already open around every test method, so {@code expireNow()} would find one whether or not it
 * declares one itself. The assertion would be green before the fix and green after it — which is
 * the same blind spot recorded in {@code e2e/COVERAGE.md} for lazy loading, arriving from the
 * opposite direction. Proving a method starts its own transaction requires there to be no
 * transaction to inherit, so this class deliberately omits {@code @Transactional}.
 *
 * <p><strong>What went wrong.</strong> {@code expireNow()} called {@code expireSignalsOlderThan} on
 * {@code this}. A self-invocation never leaves the object, so it never crosses the transactional
 * proxy, and the annotation on the inner method applied to nobody. Every tick of
 * {@code ReferralSignalRetentionSweep} since it was written threw {@code No active transaction for
 * update or delete query} — the ninety-day expiry promised in D55 had never run once. The existing
 * unit test missed it because it calls {@code expireSignalsOlderThan} directly, through the proxy,
 * which is the one entry point that was never broken. The sweep swallows the exception to keep its
 * schedule alive, so the only evidence was a daily stack trace in a log that a green suite gives
 * nobody a reason to open.
 *
 * <p><strong>Why it asserts "does not throw" rather than a row count.</strong> The defect is
 * structural — a write issued outside a transaction — and it fires before any row is considered.
 * On an empty test database the call matches nothing, writes nothing and commits nothing, which is
 * what keeps this compatible with {@code TestDatabaseIsolationTest}'s standing requirement that
 * {@code punenest_test} hold schema and nothing else. Whether the right rows are cleared is already
 * proved, at a cutoff the test chooses, by
 * {@code ReferralQualificationTest#digestsAreClearedOnceTheyLeaveTheRetentionWindow}.
 */
@SpringBootTest
class ReferralSignalRetentionSweepTest {

    @Autowired ReferralSignalRetention retention;

    @Test
    @DisplayName("expireNow() opens its own transaction, so the scheduled sweep can write")
    void expireNowRunsInATransaction() {
        assertThatCode(() -> retention.expireNow())
                .as("the sweep calls expireNow() with no ambient transaction; if it does not start "
                        + "one, the UPDATEs fail with InvalidDataAccessApiUsageException and the "
                        + "D55 ninety-day expiry silently never happens")
                .doesNotThrowAnyException();
    }
}
