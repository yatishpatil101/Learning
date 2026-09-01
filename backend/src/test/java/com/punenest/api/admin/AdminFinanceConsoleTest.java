package com.punenest.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.PlatformTime;
import com.punenest.api.common.web.Routes;
import com.punenest.api.finance.rent.RentPayment;
import com.punenest.api.finance.rent.RentPaymentRepository;
import com.punenest.api.finance.tenancy.Tenancy;
import com.punenest.api.finance.tenancy.TenancyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * The finance console's three reads (D235): the extended overview, the per-source monthly series
 * and the settlement ledger.
 *
 * <p><strong>Why the fixtures are inserted rather than seeded.</strong> The shared seed carries
 * three rent payments, <em>no</em> subscriptions and <em>no</em> boosts. Against that data every
 * assertion about MRR, the subscription book or the ledger's subscription rows passes whether the
 * query is right or wrong, because zero is the answer either way — the exact shape of test that
 * `tasks/lessons.md` calls a green record of nothing. So each test here creates the rows whose
 * absence would otherwise make it vacuous, and {@code @Transactional} rolls them back.
 *
 * <p><strong>Everything is asserted as a delta.</strong> This class shares a database with the rest
 * of the suite and the seeded book may grow; an absolute MRR would be a test that fails the day
 * somebody seeds a subscription for an unrelated reason, which trains the next reader to edit the
 * number rather than read the failure.
 *
 * <p><strong>The seeded plans are the fixtures, deliberately.</strong> Owner Plus is ₹2,499 yearly,
 * which normalises to ₹208 a month — a figure that is wrong under every plausible mistake. An
 * implementation that forgot to normalise reports 2,499; one that divided by the wrong period
 * reports 833 or 625; one that truncated instead of rounding reports 208 as well, which is why the
 * quarterly case is checked separately where truncation and rounding disagree. Picking a plan
 * priced at a round multiple of twelve would have made all of those pass.
 */
@DisplayName("/admin/finance — the console's three reads")
class AdminFinanceConsoleTest extends AbstractApiTest {

    /** Owner Plus, ₹2,499 a year. {@code round(2499 / 12.0)} is 208; truncation gives the same. */
    private static final long OWNER_PLUS_PRICE = 2499L;

    private static final long OWNER_PLUS_MONTHLY = 208L;

    /** Seeker Plus, ₹299 a month — already monthly, so it must pass through unchanged. */
    private static final long SEEKER_PLUS_PRICE = 299L;

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired TenancyRepository tenancies;
    @Autowired RentPaymentRepository payments;

    private String bearerFor(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        return bearer(users.saveAndFlush(u));
    }

    private String admin() {
        return bearerFor("9877730001", Roles.Wire.ADMIN, "Console admin");
    }

    private UUID planId(String name) {
        return jdbc.queryForObject("select id from plans where name = ?", UUID.class, name);
    }

    /**
     * A settled subscription for a brand-new member, returned with the member's display name so a
     * ledger assertion can isolate its own row from whatever else shares the database.
     */
    private String subscribe(String mobile, String displayName, String planName, String status) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(displayName);
        u.setMobileVerified(true);
        UUID userId = users.saveAndFlush(u).getId();
        jdbc.update("""
                insert into subscriptions (user_id, plan_id, status, started_at, payment_ref)
                values (?, ?, ?, now(), ?)
                """, userId, planId(planName), status, "pay_" + mobile);
        return displayName;
    }

    private String body(String url, String token) throws Exception {
        return mvc.perform(get(url).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static long num(String json, String path) {
        return ((Number) JsonPath.read(json, path)).longValue();
    }

    /** The rent on the fixture tenancy. Deliberately unlike the fee, which is the point. */
    private static final long FIXTURE_RENT = 28_000L;

    /** The platform's cut of it. Everything the ledger reports about a rent row must be this. */
    private static final long FIXTURE_FEE = 560L;

    private static final long FIXTURE_GST = 101L;

    /**
     * A settled rent payment, built from entities rather than through the rent endpoint.
     *
     * <p>The endpoint derives the month from the clock and the fee from the fee table; going
     * through it would make this fixture depend on two things that are not under test and would
     * stop the fee and the rent being reliably different numbers — which is the only property that
     * can catch the misreading this exists to catch.
     *
     * @return the tenant's display name, so a ledger query can isolate the row
     */
    private String settledRentPayment(String suffix) {
        User owner = new User("98777401" + suffix, Roles.Wire.OWNER);
        owner.setName("Ledger Landlord " + suffix);
        owner.setMobileVerified(true);
        owner = users.saveAndFlush(owner);

        User tenant = new User("98777402" + suffix, Roles.Wire.BUYER);
        tenant.setName("Ledger Tenant " + suffix);
        tenant.setMobileVerified(true);
        tenant = users.saveAndFlush(tenant);

        Property p = new Property(owner, "Ledger let flat " + suffix, "rent", "apartment",
                FIXTURE_RENT, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        properties.saveAndFlush(p);

        Tenancy t = tenancies.saveAndFlush(
                new Tenancy(p.getId(), tenant.getId(), owner.getId()));

        LocalDate month = LocalDate.now(PlatformTime.IST).withDayOfMonth(1);
        RentPayment payment = payments.saveAndFlush(new RentPayment(
                t.getId(), FIXTURE_RENT, FIXTURE_FEE, FIXTURE_GST, month, "upi", null));
        // Settled directly: only the payment webhook may flip this column, and the webhook is a
        // different slice's contract. What this class needs is a row that has definitely settled.
        jdbc.update("update rent_payments set status = 'paid', paid_date = ? where id = ?",
                java.sql.Date.valueOf(month), payment.getId());
        return tenant.getName();
    }

    @Nested
    @DisplayName("the overview's models")
    class Models {

        /**
         * The figure that replaced a seeded pseudo-random number. A yearly plan contributes a
         * twelfth of its price, not its price — which is the single most consequential arithmetic
         * on the screen, because MRR is what the business is measured by.
         */
        @Test
        void aYearlyPlanContributesATwelfthOfItsPriceToMrr() throws Exception {
            String token = admin();
            long before = num(body(Routes.Admin.FINANCE, token), "$.mrr");

            subscribe("9877730010", "Yearly Member", "Owner Plus", "active");

            long after = num(body(Routes.Admin.FINANCE, token), "$.mrr");
            assertThat(after - before)
                    .as("one Owner Plus at ₹%d a year is ₹%d a month, not ₹%d",
                            OWNER_PLUS_PRICE, OWNER_PLUS_MONTHLY, OWNER_PLUS_PRICE)
                    .isEqualTo(OWNER_PLUS_MONTHLY);
        }

        /** A plan already billed monthly must pass through untouched rather than be divided again. */
        @Test
        void aMonthlyPlanContributesItsWholePrice() throws Exception {
            String token = admin();
            long before = num(body(Routes.Admin.FINANCE, token), "$.mrr");

            subscribe("9877730011", "Monthly Member", "Seeker Plus", "active");

            assertThat(num(body(Routes.Admin.FINANCE, token), "$.mrr") - before)
                    .isEqualTo(SEEKER_PLUS_PRICE);
        }

        /**
         * MRR is a forward-looking run rate, so a subscription that will not bill again is not in
         * it — even though it is still revenue, and still on the ledger, because it was paid for.
         * That difference between {@code status = 'active'} and {@code status <> 'pending'} is the
         * whole distinction between the two questions and is easy to collapse by accident.
         */
        @Test
        void aCancelledSubscriptionLeavesMrrButStaysRevenue() throws Exception {
            String token = admin();
            String before = body(Routes.Admin.FINANCE, token);

            subscribe("9877730012", "Cancelled Member", "Owner Plus", "cancelled");

            String after = body(Routes.Admin.FINANCE, token);
            assertThat(num(after, "$.mrr") - num(before, "$.mrr"))
                    .as("a cancelled subscription bills nothing next month")
                    .isZero();
            assertThat(num(after, "$.revenue") - num(before, "$.revenue"))
                    .as("but it was paid for, so it is still revenue")
                    .isEqualTo(OWNER_PLUS_PRICE);
        }

        /**
         * Owner Free is a real, active subscription row and is not revenue. Excluded by price
         * rather than by name, so a promotional zero-rupee plan is handled on the day it is created
         * with no list for anyone to remember to update.
         */
        @Test
        void aFreePlanIsNotRevenue() throws Exception {
            String token = admin();
            String before = body(Routes.Admin.FINANCE, token);

            subscribe("9877730013", "Free Member", "Owner Free", "active");

            String after = body(Routes.Admin.FINANCE, token);
            assertThat(num(after, "$.mrr") - num(before, "$.mrr")).isZero();
            assertThat(num(after, "$.revenue") - num(before, "$.revenue")).isZero();
        }

        /**
         * The per-plan lines and the MRR total are printed on the same card, so they have to agree.
         * Asserted as an invariant over whatever the book happens to contain rather than against a
         * fixed list, which keeps the test meaningful as plans are added.
         */
        @Test
        void thePlanLinesSumToMrr() throws Exception {
            String token = admin();
            subscribe("9877730014", "Book Member", "Owner Plus", "active");

            String json = body(Routes.Admin.FINANCE, token);
            List<Map<String, Object>> plans = JsonPath.read(json, "$.plans");
            long summed = plans.stream()
                    .mapToLong(p -> ((Number) p.get("monthlyValue")).longValue())
                    .sum();

            assertThat(summed)
                    .as("the card prints the lines above the total")
                    .isEqualTo(num(json, "$.mrr"));
            assertThat(plans)
                    .as("a line must carry the sticker price, not the normalised one")
                    .anySatisfy(p -> {
                        if ("Owner Plus".equals(p.get("name"))) {
                            assertThat(((Number) p.get("price")).longValue())
                                    .isEqualTo(OWNER_PLUS_PRICE);
                            assertThat(p.get("billingCycle")).isEqualTo("yearly");
                        }
                    });
        }

        /**
         * ARPU and ARPPU have different denominators, and the console prints both precisely so that
         * neither is mistaken for the other. Everyone-with-an-account is necessarily at least as
         * large as everyone-who-paid-this-month, and a payer must have an account.
         */
        @Test
        void theTwoDenominatorsAreReportedSeparatelyAndAreOrdered() throws Exception {
            String json = body(Routes.Admin.FINANCE, admin());
            assertThat(num(json, "$.users"))
                    .as("every payer has an account, so ARPU's denominator cannot be the smaller")
                    .isGreaterThanOrEqualTo(num(json, "$.payingUsers"));
            assertThat(num(json, "$.users")).isPositive();
        }
    }

    @Nested
    @DisplayName("the monthly series")
    class Series {

        /**
         * A month in which nothing was sold must still be a bucket. A gap in a stacked bar chart is
         * not a visible gap — the neighbouring bars simply move up — so an omitted bucket reads as
         * an unbroken run of trading months that did not happen.
         */
        @Test
        void everyMonthInTheWindowIsReturnedIncludingEmptyOnes() throws Exception {
            String json = body(Routes.Admin.FINANCE_SERIES + "?months=6", admin());
            List<Object> points = JsonPath.read(json, "$");

            assertThat(points).hasSize(6);
            List<String> months = JsonPath.read(json, "$[*].month");
            assertThat(months)
                    .as("oldest first, and the last bucket is the month we are in")
                    .isSorted()
                    .last().isEqualTo(LocalDate.now(PlatformTime.IST).withDayOfMonth(1).toString());
        }

        /**
         * The services band is a measurement, not a missing field. It has to be present — the chart
         * draws four bands — and it has to be zero, because the marketplace takes no money through
         * the gateway. Its companion disclosure is asserted beside it: a zero with no flag is the
         * failure D63/D65 exists to prevent.
         */
        @Test
        void theServicesBandIsPresentAndStructurallyZero() throws Exception {
            String token = admin();
            mvc.perform(get(Routes.Admin.FINANCE_SERIES + "?months=3")
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[0].services").value(0))
                    .andExpect(jsonPath("$[*].services", org.hamcrest.Matchers.everyItem(
                            org.hamcrest.Matchers.is(0))));

            mvc.perform(get(Routes.Admin.FINANCE).header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(jsonPath("$.serviceOrdersCounted").value(false));
        }

        /**
         * The pin promised in {@code REVENUE_SERIES_BY_SOURCE}'s Javadoc. The series and the
         * overview are two independently written queries over the same three sources, and the only
         * guarantee worth having is that they agree — which no amount of shared SQL text could
         * establish on its own.
         */
        @Test
        void theCurrentMonthsBandsSumToTheOverviewsMonthRevenue() throws Exception {
            String token = admin();
            subscribe("9877730020", "Agreement Member", "Owner Plus", "active");

            String series = body(Routes.Admin.FINANCE_SERIES + "?months=1", token);
            long banded = num(series, "$[0].rent") + num(series, "$[0].subscriptions")
                    + num(series, "$[0].featured") + num(series, "$[0].services");

            assertThat(banded)
                    .as("the chart and the headline tile describe the same month")
                    .isEqualTo(num(body(Routes.Admin.FINANCE, token), "$.monthRevenue"));
            assertThat(banded)
                    .as("and the fixture makes this a real comparison, not 0 == 0")
                    .isGreaterThanOrEqualTo(OWNER_PLUS_PRICE);
        }

        @Test
        void aWindowOutsideTheAllowedRangeIsRefused() throws Exception {
            String token = admin();
            for (String months : List.of("0", "61", "-1")) {
                mvc.perform(get(Routes.Admin.FINANCE_SERIES + "?months=" + months)
                                .header(HttpHeaders.AUTHORIZATION, token))
                        .andExpect(status().isBadRequest());
            }
        }
    }

    @Nested
    @DisplayName("the settlement ledger")
    class Ledger {

        /**
         * The row carries what was charged, not what it normalises to. The ledger reconciles against
         * a bank statement, and the bank saw ₹2,499 leave an account once.
         */
        @Test
        void aSettledSubscriptionAppearsAtItsStickerPrice() throws Exception {
            String token = admin();
            String name = subscribe("9877730030", "Ledger Member", "Owner Plus", "active");

            mvc.perform(get(Routes.Admin.FINANCE_TRANSACTIONS)
                            .param("q", name)
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalElements").value(1))
                    .andExpect(jsonPath("$.content[0].kind").value("subscription"))
                    .andExpect(jsonPath("$.content[0].amount").value((int) OWNER_PLUS_PRICE))
                    .andExpect(jsonPath("$.content[0].status").value("paid"))
                    .andExpect(jsonPath("$.content[0].party").value(name));
        }

        /**
         * A free plan is not a movement of money, so it is not a row. Without this, the ledger would
         * show every Owner Free signup as a ₹0 transaction and bury the ones that matter.
         */
        @Test
        void aFreePlanIsNotALedgerRow() throws Exception {
            String token = admin();
            String name = subscribe("9877730031", "Freebie Member", "Owner Free", "active");

            mvc.perform(get(Routes.Admin.FINANCE_TRANSACTIONS)
                            .param("q", name)
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalElements").value(0));
        }

        /**
         * The mock ledger called a settled row {@code closed} and offered {@code refunded}. Both
         * are gone, and asking for either has to say so — an accepted-but-unmatchable filter
         * returns an empty page, which is indistinguishable from a quarter in which nothing sold.
         */
        @Test
        void aVocabularyTheLedgerCannotMatchIsRefusedRatherThanReturningNothing() throws Exception {
            String token = admin();
            mvc.perform(get(Routes.Admin.FINANCE_TRANSACTIONS + "?status=closed")
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isBadRequest());
            mvc.perform(get(Routes.Admin.FINANCE_TRANSACTIONS + "?status=refunded")
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isBadRequest());
            mvc.perform(get(Routes.Admin.FINANCE_TRANSACTIONS + "?kind=deal")
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isBadRequest());
        }

        /** The acceptance half of the rejection above — otherwise "refuses everything" would pass. */
        @Test
        void theVocabularyItDoesSpeakIsAccepted() throws Exception {
            String token = admin();
            for (String kind : List.of("rent_fee", "subscription", "featured")) {
                mvc.perform(get(Routes.Admin.FINANCE_TRANSACTIONS + "?kind=" + kind)
                                .header(HttpHeaders.AUTHORIZATION, token))
                        .andExpect(status().isOk());
            }
            for (String state : List.of("paid", "pending", "failed")) {
                mvc.perform(get(Routes.Admin.FINANCE_TRANSACTIONS + "?status=" + state)
                                .header(HttpHeaders.AUTHORIZATION, token))
                        .andExpect(status().isOk());
            }
        }

        /**
         * A rent row carries the platform's fee and not the rent. This is the single most likely
         * misreading of this table — the rent is the largest number in the row and the one a reader
         * expects to see — and the fixture is built so the two cannot be confused: ₹28,000 of rent
         * against a ₹560 fee.
         */
        @Test
        void aRentRowCarriesTheFeeAndNotTheRent() throws Exception {
            String token = admin();
            String tenant = settledRentPayment("51");

            mvc.perform(get(Routes.Admin.FINANCE_TRANSACTIONS)
                            .param("kind", "rent_fee").param("q", tenant)
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalElements").value(1))
                    .andExpect(jsonPath("$.content[0].amount").value((int) FIXTURE_FEE))
                    .andExpect(jsonPath("$.content[0].status").value("paid"))
                    .andExpect(jsonPath("$.content[0].method").value("upi"))
                    .andExpect(jsonPath("$.content[0].party").value(tenant));
        }


        /**
         * The fee is also what reaches revenue, and the GST beside it is reported separately rather
         * than folded in — pass-through tax is not income. Asserted together because the failure
         * mode is one number being used for both.
         */
        @Test
        void theRentFeeIsRevenueAndItsGstIsNot() throws Exception {
            String token = admin();
            String before = body(Routes.Admin.FINANCE, token);

            settledRentPayment("52");

            String after = body(Routes.Admin.FINANCE, token);
            assertThat(num(after, "$.revenue") - num(before, "$.revenue"))
                    .as("the fee, not the rent and not the fee plus tax")
                    .isEqualTo(FIXTURE_FEE);
            assertThat(num(after, "$.gstCollected") - num(before, "$.gstCollected"))
                    .as("tax is reported on its own line")
                    .isEqualTo(FIXTURE_GST);
        }

        /** Contact details have no place on a finance ledger; the party is a name. */
        @Test
        void noRowCarriesAMobileNumber() throws Exception {
            String token = admin();
            settledRentPayment("53");
            subscribe("9877730032", "Privacy Member", "Owner Plus", "active");

            String json = body(Routes.Admin.FINANCE_TRANSACTIONS + "?size=100", token);
            List<String> parties = JsonPath.read(json, "$.content[*].party");
            assertThat(parties).as("the floor: the scan found rows to measure").isNotEmpty();
            assertThat(parties)
                    .noneMatch(p -> p.matches(".*(?<!\\d)(?:\\+91[\\s-]?)?[6-9]\\d{9}(?!\\d).*"));
        }
    }

    @Nested
    @DisplayName("the guard")
    class Guard {

        /**
         * All three carry the same expression. A sibling route that settled for the staff guard
         * would hand out exactly what making {@code /admin/finance} admin-only was for — the
         * series is the revenue mix spread across a timeline, and the ledger is every one of its
         * rows.
         */
        @Test
        void staffCannotReadAnyOfTheThree() throws Exception {
            String staff = bearerFor("9877730040", Roles.Wire.STAFF, "Ops staff");
            for (String route : List.of(Routes.Admin.FINANCE, Routes.Admin.FINANCE_SERIES,
                    Routes.Admin.FINANCE_TRANSACTIONS)) {
                mvc.perform(get(route).header(HttpHeaders.AUTHORIZATION, staff))
                        .andExpect(status().isForbidden());
            }
        }

        /** The acceptance half: an administrator reaches all three, so the guard is not blanket. */
        @Test
        void anAdministratorReachesAllThree() throws Exception {
            String token = admin();
            for (String route : List.of(Routes.Admin.FINANCE, Routes.Admin.FINANCE_SERIES,
                    Routes.Admin.FINANCE_TRANSACTIONS)) {
                mvc.perform(get(route).header(HttpHeaders.AUTHORIZATION, token))
                        .andExpect(status().isOk());
            }
        }
    }
}

