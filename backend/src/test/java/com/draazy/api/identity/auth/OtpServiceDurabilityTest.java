package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.provider.OtpSender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

/**
 * Guards that the per-code OTP attempt cap is <em>durable across transactions</em> — the failure mode
 * that only bites in prod, where each verify is a separate request/tx. Deliberately <strong>not</strong>
 * {@code @Transactional}: wrapping every call in one rolled-back tx would mask exactly the bug this
 * guards (a wrong-guess attempt increment being rolled back together with the thrown 401, so the cap
 * never accumulates). The {@code noRollbackFor} on {@code verifyLoginCode} is what makes this pass.
 *
 * <p>The send budget is the same kind of claim from the other end — it is spent by rows that must
 * outlive a thrown delivery failure — so it is guarded here too, and for the same reason it cannot
 * be guarded anywhere transactional.
 *
 * <p>Being non-transactional means nothing rolls the written rows back, and {@code sendLoginCode}
 * rate-limits on exactly those rows — {@code MAX_SENDS_PER_WINDOW} per mobile per rolling hour. Left
 * alone the test therefore poisons itself: the fifth {@code mvn verify} inside an hour fails at the
 * <em>first</em> line with a 429, a failure that says nothing about the cap it is guarding. So it
 * clears its own number first rather than assuming a fresh database, and again afterwards so it
 * leaves none behind. The number is test-only and matched by no other test.
 */
@SpringBootTest
class OtpServiceDurabilityTest {

    private static final String MOBILE = "9876500911";

    @Autowired
    OtpService otpService;
    @Autowired
    CapturingOtpSender otp;
    @Autowired
    OuterTransaction outer;
    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    @AfterEach
    void clearOwnSendHistory() {
        jdbc.update("delete from otp_codes where mobile = ?", MOBILE);
        otp.failNext = false;
    }

    /**
     * A send the provider could not deliver must still cost the caller its slot.
     *
     * <p>The send budget is not a counter — it is derived from the {@code otp_codes} rows. So if a
     * provider failure rolled the transaction back, the attempt would cost nothing: no cooldown, no
     * window slot, no trace, and the one limit standing between a chosen number and being rung on
     * demand would be refunded on every failed call. Worse under load, not better, because a vendor
     * throttles per-account: the failure rate climbs with the volume of the abuse.
     *
     * <p>This test can only live outside a test transaction. Under {@code @Transactional} the row is
     * rolled back at the end regardless, so the assertion would pass whether or not the fix exists —
     * the same reason the class above it is not transactional.
     */
    @Test
    void aFailedDeliveryStillSpendsTheSendBudget() {
        otp.failNext = true;

        assertThatThrownBy(() -> otpService.sendLoginCode(MOBILE))
                .isInstanceOf(OtpSender.DeliveryFailedException.class);

        Integer rows = jdbc.queryForObject(
                "select count(*) from otp_codes where mobile = ?", Integer.class, MOBILE);
        assertThat(rows).isEqualTo(1);
    }

    /**
     * The same claim, but with an <em>outer</em> transaction owning the send.
     *
     * <p>Worth its own test because the two cases fail differently and only one of them is obvious.
     * {@code noRollbackFor} on {@code OtpService.sendCode} stops <em>that</em> advice from marking a
     * shared transaction rollback-only; it has no say over an advice that owns the transaction and
     * evaluates its own rules. So the rule has to be repeated on every method that can own one, and
     * the test above — where {@code sendLoginCode} owns it — passes whether or not that was done.
     * {@code FlatmateSupplyService.ownerConsent} is the real instance of this shape and was missing
     * the rule; this stands in for it without the group fixture, because what is being guarded is
     * the propagation behaviour, not the flatmates flow.
     */
    @Test
    void aFailedDeliverySpendsTheBudgetEvenWhenAnOuterTransactionOwnsIt() {
        otp.failNext = true;

        assertThatThrownBy(() -> outer.sendInsideItsOwnTransaction(MOBILE))
                .isInstanceOf(OtpSender.DeliveryFailedException.class);

        Integer rows = jdbc.queryForObject(
                "select count(*) from otp_codes where mobile = ?", Integer.class, MOBILE);
        assertThat(rows).isEqualTo(1);
    }

    @Test
    void failedAttemptsAccumulateAcrossTransactionsUntilTheCapTrips() {
        otpService.sendLoginCode(MOBILE);
        // A code guaranteed to differ from the real one, so every verify takes the wrong-guess path.
        String wrong = "000000".equals(otp.lastCode) ? "111111" : "000000";

        for (int i = 0; i < OtpService.MAX_ATTEMPTS; i++) {
            assertThatThrownBy(() -> otpService.verifyLoginCode(MOBILE, wrong))
                    .isInstanceOf(UnauthorizedException.class);
        }
        // Once the cap is reached the code is burned and further tries are rate-limited (429).
        assertThatThrownBy(() -> otpService.verifyLoginCode(MOBILE, wrong))
                .isInstanceOf(RateLimitedException.class);
    }

    static class CapturingOtpSender implements OtpSender {
        volatile String lastCode;
        /** Makes the next send fail the way a real provider does when the vendor call fails. */
        volatile boolean failNext;

        @Override
        public void send(String mobile, String code) {
            this.lastCode = code;
            if (failNext) {
                failNext = false;
                throw new DeliveryFailedException("simulated provider failure", null);
            }
        }
    }

    @TestConfiguration
    static class Config {
        @Bean
        @Primary
        CapturingOtpSender capturingOtpSender() {
            return new CapturingOtpSender();
        }

        @Bean
        OuterTransaction outerTransaction(OtpService otpService) {
            return new OuterTransaction(otpService);
        }
    }

    /**
     * Stands in for {@code AuthService.login} and {@code FlatmateSupplyService.ownerConsent}: a bean
     * that owns a transaction and calls the OTP seam inside it. Both of those name
     * {@link OtpSender.DeliveryFailedException} in their own {@code noRollbackFor}; so does this, and
     * removing it here reproduces the bug the sibling test cannot see.
     */
    static class OuterTransaction {
        private final OtpService otpService;

        OuterTransaction(OtpService otpService) {
            this.otpService = otpService;
        }

        @Transactional(noRollbackFor = OtpSender.DeliveryFailedException.class)
        public void sendInsideItsOwnTransaction(String mobile) {
            otpService.sendLoginCode(mobile);
        }
    }
}
