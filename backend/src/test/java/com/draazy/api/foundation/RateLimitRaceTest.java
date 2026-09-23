package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.persistence.RateLimitLock;
import com.draazy.api.identity.auth.OtpCode;
import com.draazy.api.identity.auth.OtpCodeRepository;
import com.draazy.api.identity.auth.OtpSendBudget;
import com.draazy.api.identity.auth.OtpService;
import com.draazy.api.leads.society.SocietyLeadCreateRequest;
import com.draazy.api.leads.society.SocietyLeadService;
import com.draazy.api.provider.OtpSender;
import com.draazy.api.support.Races;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

// Cannot be @Transactional: the bug is that one writer's *committed* row is missed by another's
// count, which a rolling-back harness cannot express. cleanUp() is load-bearing.
@SpringBootTest
@DisplayName("Rate limits under concurrency — real threads, real commits (D73)")
class RateLimitRaceTest {

    /** These rows genuinely commit, so a mobile shared with another test becomes its fixture. */
    private static final String LEAD_MOBILE = "9876000073";
    private static final String OTP_MOBILE = "9876000173";
    private static final String CALLER_MOBILE = "9876000273";

    /** Outside {@link #CALLER_MOBILE}'s own value, so the caller never appears in its own count. */
    private static final String RECIPIENT_PREFIX = "987600037";

    /** {@code SocietyLeadService.MAX_SUBMISSIONS}, which is private and deliberately not exposed. */
    private static final int LEAD_CAP = 3;

    @Autowired SocietyLeadService societyLeads;
    @Autowired OtpCodeRepository otpCodes;
    @Autowired OtpSender otpSender;
    @Autowired RateLimitLock locks;
    @Autowired Environment environment;
    @Autowired PlatformTransactionManager txManager;
    @Autowired JdbcTemplate jdbc;

    private TransactionTemplate tx;

    @BeforeEach
    void setUp() {
        tx = new TransactionTemplate(txManager);
        cleanUp();
    }

    @AfterEach
    void cleanUp() {
        jdbc.update("delete from society_leads where mobile = ?", LEAD_MOBILE);
        jdbc.update("delete from otp_codes where mobile = ?", OTP_MOBILE);
        // Before the user: these rows charge their sends to it, and that reference is
        // ON DELETE RESTRICT, so the other order is an FK violation rather than a silent null.
        jdbc.update("delete from otp_codes where mobile like ?", RECIPIENT_PREFIX + "%");
        jdbc.update("delete from users where mobile = ?", CALLER_MOBILE);
    }

    private static SocietyLeadCreateRequest lead() {
        return new SocietyLeadCreateRequest(
                "Race Test Society", "Secretary", LEAD_MOBILE, 120, "bulk-listing");
    }

    private long leadRows() {
        return count("select count(*) from society_leads where mobile = ?", LEAD_MOBILE);
    }

    private long count(String sql, String argument) {
        Long rows = jdbc.queryForObject(sql, Long.class, argument);
        return rows == null ? 0 : rows;
    }

    private static long refusals(List<Throwable> outcomes) {
        for (Throwable outcome : outcomes) {
            if (outcome != null && !(outcome instanceof RateLimitedException)) {
                // A unique-index collision or lock timeout is a 500 in production; counting it as
                // "refused" would let this pass while the endpoint answered with an internal error.
                throw new AssertionError(
                        "a racer failed with something other than the business refusal", outcome);
            }
        }
        return outcomes.stream().filter(RateLimitedException.class::isInstance).count();
    }

    /** Two are committed first so exactly one slot remains; serially only one racer can win it. */
    @Test
    @DisplayName("three simultaneous society-lead submits fill one remaining slot, not three")
    void societyLeadSubmitsCannotOverfillTheCap() {
        societyLeads.submit(lead());
        societyLeads.submit(lead());
        assertThat(leadRows()).isEqualTo(LEAD_CAP - 1);

        List<Throwable> outcomes = Races.run(3, index -> societyLeads.submit(lead()));

        assertThat(refusals(outcomes))
                .as("two of the three racers must be refused")
                .isEqualTo(2);
        assertThat(leadRows())
                .as("the cap is a cap, not an average — a burst must not buy extra rows")
                .isEqualTo(LEAD_CAP);
    }

    // Hand-built with a cap of two so the race is reachable, and driven by a TransactionTemplate
    // because an unproxied bean gets no transaction for the lock.
    @Test
    @DisplayName("three simultaneous OTP sends to one number spend one slot, not three")
    void otpSendsCannotOverspendTheWindowBudget() {
        // The platform ceiling stays wide: a second limit tight enough to fire would refuse the
        // racers for the wrong reason. This races on `login`, exempt from the other two quotas.
        OtpService tightBudget = new OtpService(otpCodes, otpSender,
                new OtpSendBudget(otpCodes, locks, 0, 2, 500, 500, 500),
                environment, "", "", 3);

        tx.executeWithoutResult(status ->
                tightBudget.sendSelfServiceCode(OTP_MOBILE, OtpCode.PURPOSE_LOGIN));
        assertThat(otpRows()).isEqualTo(1);

        List<Throwable> outcomes = Races.run(3, index ->
                tx.executeWithoutResult(status ->
                        tightBudget.sendSelfServiceCode(OTP_MOBILE, OtpCode.PURPOSE_LOGIN)));

        assertThat(refusals(outcomes))
                .as("two of the three racers must be refused")
                .isEqualTo(2);
        assertThat(otpRows())
                .as("each surviving row is one SMS the platform paid for and one the owner of this "
                        + "number did not ask for")
                .isEqualTo(2);
    }

    private long otpRows() {
        return count("select count(*) from otp_codes where mobile = ?", OTP_MOBILE);
    }

    // Budgets are left wide so a refusal can only be the lock, and each racer names a different
    // recipient and flat so no other key serialises them — the count depends on real overlap.
    @Test
    @DisplayName("one account's three simultaneous consent sends buy one code, not three")
    void oneCallerCannotSendConcurrentlyToThreeDifferentFlats() {
        UUID caller = jdbc.queryForObject(
                "insert into users (mobile) values (?) returning id", UUID.class, CALLER_MOBILE);
        OtpService wideBudget = new OtpService(otpCodes, otpSender,
                new OtpSendBudget(otpCodes, locks, 0, 500, 500, 500, 500),
                environment, "", "", 3);

        List<Throwable> outcomes = Races.run(3, index ->
                tx.executeWithoutResult(status -> wideBudget.sendCode(recipient(index),
                        OtpCode.PURPOSE_OWNER_CONSENT + ":flat" + index, caller)));

        assertThat(refusals(outcomes))
                .as("two of the three racers must be refused")
                .isEqualTo(2);
        assertThat(callerRows())
                .as("naming a fresh number and a fresh flat must not buy a fresh slot — that is the "
                        + "whole of the per-caller quota")
                .isEqualTo(1);
    }

    private static String recipient(int index) {
        return RECIPIENT_PREFIX + index;
    }

    private long callerRows() {
        return count("select count(*) from otp_codes where mobile like ?", RECIPIENT_PREFIX + "%");
    }
}
