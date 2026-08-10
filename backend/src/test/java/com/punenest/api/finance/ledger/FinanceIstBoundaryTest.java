package com.punenest.api.finance.ledger;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.util.AopTestUtils;

/**
 * The finance aggregates bucket by the Indian calendar, not by the host's — tech debt D174.
 *
 * <p><strong>The bug this pins.</strong> {@code FinanceService} used to read bare
 * {@code LocalDate.now()} and {@code YearMonth.now()}, which resolve against
 * {@code TimeZone.getDefault()}. On a UTC host the JVM is still on <em>yesterday's</em> date for the
 * first 5.5 hours of every Indian day, so between 00:00 and 05:29 IST:
 * <ul>
 *   <li>1 April — the first day of the Indian financial year — was answered as 31 March, and
 *       {@code period=year} returned the whole of the FY that had just <em>ended</em>;</li>
 *   <li>the 1st of any month was answered as the last day of the previous one, so
 *       {@code period=month} and the {@code /cashflow} series were both a month behind;</li>
 *   <li>{@code /dues} reported one extra day until everything.</li>
 * </ul>
 * An owner opening the Finances tab over morning chai would be shown last year's books, and would
 * be shown this year's if they refreshed after 05:30. That is the worst kind of wrong number: one
 * that corrects itself before anyone can reproduce it.
 *
 * <p><strong>Why the pinned clock is deliberately UTC-zoned.</strong> {@link Clock#fixed} carries a
 * zone of its own, and pinning it to {@code Asia/Kolkata} would prove only that this test knows
 * about IST. Pinning it to {@link ZoneOffset#UTC} reproduces the exact host configuration that
 * causes the bug, so every IST answer asserted below is one the <em>service</em> chose.
 *
 * <p>The instant is 2026-03-31T20:00:00Z, which is 01:30 on 1 April 2026 in India: simultaneously
 * the previous financial year, the previous month and the previous day to a UTC host.
 */
class FinanceIstBoundaryTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired FinanceService financeService;

    /** 01:30 IST on 1 April 2026 — still 31 March 2026 to a UTC host. */
    private static final Instant IST_NEW_FY_MIDNIGHT = Instant.parse("2026-03-31T20:00:00Z");

    /** The date the service must derive. */
    private static final LocalDate FIRST_OF_NEW_FY = LocalDate.of(2026, 4, 1);

    /** A row inside the FY that ends the instant above, and inside the previous calendar month. */
    private static final LocalDate LAST_FY = LocalDate.of(2026, 3, 20);

    private static final long NEW_FY_INCOME = 500_000L;
    private static final long LAST_FY_INCOME = 700_000L;

    /**
     * Restore the system clock. The service is an application-scoped singleton, so a pinned clock
     * left behind would follow every later test in this JVM into 2026.
     */
    @AfterEach
    void unpinClock() {
        target().useClock(null);
    }

    /**
     * The bean behind the {@code @Transactional} proxy. Writing the field through the proxy would
     * set it on the CGLIB subclass and leave the target — the object whose methods actually run —
     * on the system clock, so the test would pass for the wrong reason.
     */
    private FinanceService target() {
        return AopTestUtils.getTargetObject(financeService);
    }

    private void pinToIstNewFinancialYear() {
        target().useClock(Clock.fixed(IST_NEW_FY_MIDNIGHT, ZoneOffset.UTC));
    }

    // ---- fixture ----

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Boundary Owner " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "Boundary listing", "rent", "apartment",
                25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    /**
     * Post one income row. Written before the clock is pinned in every test below, because
     * {@code addTransaction} takes the date from the request body and never reads the clock — the
     * seed must not depend on the thing under test.
     */
    private void income(User owner, Property p, long amount, LocalDate date) throws Exception {
        mvc.perform(post("/me/finances/" + p.getId() + "/transactions")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"income\",\"amount\":" + amount
                                + ",\"date\":\"" + date + "\"}"))
                .andExpect(status().isCreated());
    }

    /** One row either side of the FY boundary — 20 March 2026 and 1 April 2026. */
    private Property ledgerStraddlingTheFyBoundary(User owner) throws Exception {
        Property p = listing(owner);
        income(owner, p, LAST_FY_INCOME, LAST_FY);
        income(owner, p, NEW_FY_INCOME, FIRST_OF_NEW_FY);
        return p;
    }

    // ---- 1: the financial year boundary ----

    /**
     * {@code period=year} starts on 1 April, and at 01:30 IST on 1 April that is <em>today</em>.
     *
     * <p>The discriminating number is {@link #LAST_FY_INCOME}. On the system default of a UTC host
     * the service would read 31 March, {@code SummaryPeriods.startOf} would answer 1 April
     * <em>2025</em>, and this window would return both rows — the whole of the financial year that
     * had ended ninety minutes earlier, presented to the owner as "this year".
     */
    @Test
    void summaryPeriodYear_startsOnTheIndianFyBoundary_notTheHostsPreviousDay() throws Exception {
        User owner = owner("9833100001");
        Property p = ledgerStraddlingTheFyBoundary(owner);

        pinToIstNewFinancialYear();

        // Both rows exist: without this the assertion below could pass on an empty ledger.
        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=all")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.income").value(LAST_FY_INCOME + NEW_FY_INCOME));

        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=year")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.income").value(NEW_FY_INCOME));
    }

    // ---- 2: the calendar month boundary ----

    /**
     * {@code period=month} starts on the 1st of the Indian month. A UTC host would read 31 March
     * and open the window on 1 March, pulling the previous month's row into "this month".
     */
    @Test
    void summaryPeriodMonth_startsOnTheIndianMonth_notTheHostsPreviousOne() throws Exception {
        User owner = owner("9833100002");
        Property p = ledgerStraddlingTheFyBoundary(owner);

        pinToIstNewFinancialYear();

        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=month")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.income").value(NEW_FY_INCOME));
    }

    /**
     * The cashflow series ends with the Indian month, and says so in the label.
     *
     * <p>{@code months=1} reduces the series to the single bucket the bug moves: IST answers
     * {@code 2026-04} carrying April's row, a UTC host answers {@code 2026-03} carrying March's.
     * The month string is asserted as well as the total because the label is what the chart's axis
     * shows — a series that is a month out but internally consistent still misleads.
     */
    @Test
    void cashflow_endsWithTheIndianMonth_notTheHostsPreviousOne() throws Exception {
        User owner = owner("9833100003");
        Property p = ledgerStraddlingTheFyBoundary(owner);

        pinToIstNewFinancialYear();

        mvc.perform(get("/me/finances/" + p.getId() + "/cashflow?months=1")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].month").value("2026-04"))
                .andExpect(jsonPath("$[0].income").value(NEW_FY_INCOME));
    }

    // ---- 3: dues count days from the Indian date ----

    /**
     * A monthly row anchored on the 1st is due <em>today</em> at 01:30 IST on 1 April, not
     * tomorrow.
     *
     * <p>{@code daysUntil} is the number the UI turns into "due today" or a red badge. Reading the
     * host's 31 March would answer 1, and an owner whose EMI is debited that morning would be told
     * it had not fallen due yet.
     */
    @Test
    void dues_countDaysFromTheIndianDate_notTheHostsPreviousDay() throws Exception {
        User owner = owner("9833100004");
        Property p = listing(owner);

        mvc.perform(post("/me/finances/" + p.getId() + "/transactions")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"expense\",\"category\":\"Home loan EMI\","
                                + "\"amount\":250000,\"date\":\"2026-01-01\","
                                + "\"recurring\":\"monthly\"}"))
                .andExpect(status().isCreated());

        pinToIstNewFinancialYear();

        mvc.perform(get("/me/finances/" + p.getId() + "/dues")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].nextDue").value(FIRST_OF_NEW_FY.toString()))
                .andExpect(jsonPath("$[0].daysUntil").value(0));
    }
}
