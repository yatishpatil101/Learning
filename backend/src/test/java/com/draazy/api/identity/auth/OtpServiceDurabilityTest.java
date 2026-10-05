package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.identity.auth.OtpCaptureConfig.CapturingOtpSender;
import com.draazy.api.identity.auth.OtpCaptureConfig.OuterTransaction;
import com.draazy.api.provider.OtpSender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Not {@code @Transactional} on purpose: a rolled-back harness masks the bug, since the attempt and
 * send rows must outlive a thrown 401 or delivery failure. It clears its own mobile to stay rerunnable.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(OtpCaptureConfig.class)
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
     * The budget is derived from rows, so a rolled-back delivery failure would refund the slot and
     * leave a chosen number rung on demand. See docs/flows/consumer/auth.md.
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
     * {@code noRollbackFor} is per-advice, so the rule must be repeated on every method that can own
     * the transaction — a case the sibling test above structurally cannot see.
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

        for (int i = 0; i < otpService.maxVerifyAttempts(); i++) {
            assertThatThrownBy(() -> otpService.verifyLoginCode(MOBILE, wrong))
                    .isInstanceOf(UnauthorizedException.class);
        }
        // Once the cap is reached the code is burned and further tries are rate-limited (429).
        assertThatThrownBy(() -> otpService.verifyLoginCode(MOBILE, wrong))
                .isInstanceOf(RateLimitedException.class);
    }
}
