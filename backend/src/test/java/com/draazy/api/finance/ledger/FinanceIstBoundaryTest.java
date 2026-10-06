package com.draazy.api.finance.ledger;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
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

/** The finance aggregates bucket by the Indian calendar, not the host's: the clock is pinned in UTC (01:30 IST on
 * 1 April) to reproduce the host config that put them a day, month or financial year behind. */
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

    /** The service is a singleton, so a pinned clock left behind would follow every later test in this JVM. */
    @AfterEach
    void unpinClock() {
        target().useClock(null);
    }

    /** The bean behind the proxy: a field set on the CGLIB subclass leaves the real target on the system clock. */
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

    /** Posted before the clock is pinned: {@code addTransaction} takes the date from the body, not the clock. */
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

    /** {@code period=year} starts 1 April (today, 01:30 IST); a UTC host would read 31 March, adding last FY. */
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

    /** {@code period=month} must start on the 1st of the Indian month; a UTC host would open it on 1 March. */
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

    /** {@code months=1} isolates the bucket the bug moves; the label is asserted too since the axis shows it. */
    @Test
    void cashflow_endsWithTheIndianMonth_notTheHostsPreviousOne() throws Exception {
        User owner = owner("9833100003");
        Property p = ledgerStraddlingTheFyBoundary(owner);

        pinToIstNewFinancialYear();

        mvc.perform(get("/me/finances/" + p.getId() + "/overview?months=1")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cashflow.length()").value(1))
                .andExpect(jsonPath("$.cashflow[0].month").value("2026-04"))
                .andExpect(jsonPath("$.cashflow[0].income").value(NEW_FY_INCOME));
    }

    // ---- 3: dues count days from the Indian date ----

    /** A row anchored on the 1st is due today, not tomorrow; a UTC host would answer {@code daysUntil} 1. */
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

        mvc.perform(get("/me/finances/" + p.getId() + "/overview")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dues.length()").value(1))
                .andExpect(jsonPath("$.dues[0].nextDue").value(FIRST_OF_NEW_FY.toString()))
                .andExpect(jsonPath("$.dues[0].daysUntil").value(0));
    }
}
