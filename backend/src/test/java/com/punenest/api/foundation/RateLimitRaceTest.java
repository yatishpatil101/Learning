package com.punenest.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.common.error.RateLimitedException;
import com.punenest.api.common.persistence.RateLimitLock;
import com.punenest.api.identity.auth.OtpCode;
import com.punenest.api.identity.auth.OtpCodeRepository;
import com.punenest.api.identity.auth.OtpService;
import com.punenest.api.leads.society.SocietyLeadCreateRequest;
import com.punenest.api.leads.society.SocietyLeadService;
import com.punenest.api.provider.OtpSender;
import com.punenest.api.support.Races;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The count-then-insert rate limits hold under a burst (D73).
 *
 * <p><strong>Read the annotations before the assertions.</strong> There is no {@code @Transactional}
 * here and there cannot be. Every other HTTP test in this codebase extends
 * {@code AbstractApiTest}, which rolls back — and a rolled-back write is invisible to every other
 * connection, forever. The bug this class is about is precisely that a second writer's count does
 * not include a first writer's <em>committed</em> row, so a rolling-back harness cannot express it:
 * it would pass identically before and after the fix, which is the D90 failure mode exactly. So the
 * rows here are real, the commits are real, the threads are real, and the {@link #cleanUp()} below
 * is load-bearing — 126 assertions elsewhere in this suite are exact row counts.
 *
 * <p><strong>What each test would look like if the fix were reverted.</strong> Every racing thread
 * reads the same pre-insert count, every one finds room, and every one inserts — so the success
 * count and the committed row count both come out one or two too high. That is why each test asserts
 * on both: a limiter that refused the right number of callers and still wrote the wrong number of
 * rows would be just as broken, and only the second assertion would catch it.
 *
 * <p>The flatmate half of D73 lives in {@code FlatmateInterestRaceTest}, which has to sit in the
 * flatmates package to build its fixture.
 */
@SpringBootTest
@DisplayName("Rate limits under concurrency — real threads, real commits (D73)")
class RateLimitRaceTest {

    /**
     * Distinct from every mobile used elsewhere in the suite, because these rows genuinely commit
     * and a shared number would make one test's litter another test's fixture (the D100 shape).
     */
    private static final String LEAD_MOBILE = "9876000073";
    private static final String OTP_MOBILE = "9876000173";

    /** {@code SocietyLeadService.MAX_SUBMISSIONS}, which is private and deliberately not exposed. */
    private static final int LEAD_CAP = 3;

    @Autowired SocietyLeadService societyLeads;
    @Autowired OtpCodeRepository otpCodes;
    @Autowired OtpSender otpSender;
    @Autowired RateLimitLock locks;
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
    }

    private static SocietyLeadCreateRequest lead() {
        return new SocietyLeadCreateRequest(
                "Race Test Society", "Secretary", LEAD_MOBILE, 120, "bulk-listing");
    }

    private long leadRows() {
        Long n = jdbc.queryForObject(
                "select count(*) from society_leads where mobile = ?", Long.class, LEAD_MOBILE);
        return n == null ? 0 : n;
    }

    private static long refusals(List<Throwable> outcomes) {
        for (Throwable outcome : outcomes) {
            if (outcome != null && !(outcome instanceof RateLimitedException)) {
                // Not a style choice: a unique-index collision or a lock timeout surfacing here
                // would be a 500 in production, and counting it as "refused" would let this test
                // pass while the endpoint answered the caller with an internal error.
                throw new AssertionError(
                        "a racer failed with something other than the business refusal", outcome);
            }
        }
        return outcomes.stream().filter(RateLimitedException.class::isInstance).count();
    }

    /**
     * The public lead form, which is the platform's only unauthenticated write and therefore the
     * cheapest of the three to burst.
     *
     * <p>Two submissions are committed first, so exactly one slot of the three remains. Three
     * callers then arrive together. Serially only one of them can win; before the fix all three read
     * "two so far", all three found room, and the ops queue took five.
     */
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

    /**
     * The OTP send budget, which is the one that costs money and rings a stranger's phone.
     *
     * <p><strong>Why the service is built by hand.</strong> The container's {@code OtpService} is
     * configured from the active profile, and the test run activates {@code dev} — cooldown 0 and a
     * hundred sends an hour, deliberately, so local development is not throttled against a mock
     * sender. Racing that would need a hundred committed codes to reach the ceiling. This builds the
     * same class with the same collaborators and a cap of two, which exercises the identical code
     * path and leaves the profile numbers exactly where they are: nothing here reads, writes or
     * overrides {@code punenest.otp.*}, so dev keeps its loosening and prod keeps 60s / 5.
     *
     * <p>The {@link TransactionTemplate} supplies what {@code @Transactional} would: a
     * hand-constructed bean has no proxy, and the lock has to be inside a transaction to outlive the
     * statement that takes it.
     */
    @Test
    @DisplayName("three simultaneous OTP sends to one number spend one slot, not three")
    void otpSendsCannotOverspendTheWindowBudget() {
        OtpService tightBudget = new OtpService(otpCodes, otpSender, locks, 0, 2);

        tx.executeWithoutResult(status -> tightBudget.sendCode(OTP_MOBILE, OtpCode.PURPOSE_LOGIN));
        assertThat(otpRows()).isEqualTo(1);

        List<Throwable> outcomes = Races.run(3, index ->
                tx.executeWithoutResult(status ->
                        tightBudget.sendCode(OTP_MOBILE, OtpCode.PURPOSE_LOGIN)));

        assertThat(refusals(outcomes))
                .as("two of the three racers must be refused")
                .isEqualTo(2);
        assertThat(otpRows())
                .as("each surviving row is one SMS the platform paid for and one the owner of this "
                        + "number did not ask for")
                .isEqualTo(2);
    }

    private long otpRows() {
        Long n = jdbc.queryForObject(
                "select count(*) from otp_codes where mobile = ?", Long.class, OTP_MOBILE);
        return n == null ? 0 : n;
    }
}
