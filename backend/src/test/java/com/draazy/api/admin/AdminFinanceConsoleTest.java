package com.draazy.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/** The seed carries no subscriptions or boosts, so each test inserts its own rows and asserts
 *  deltas — the database is shared and the seeded book may grow. */
@DisplayName("/admin/finance — the console's three reads")
class AdminFinanceConsoleTest extends AbstractApiTest {

    /** Owner Pro, ₹2,499 a year. {@code round(2499 / 12.0)} is 208; truncation gives the same. */
    private static final long OWNER_PRO_PRICE = 2499L;

    private static final long OWNER_PRO_MONTHLY = 208L;

    /** Seeker Plus, ₹199 a month — already monthly, so it must pass through unchanged. */
    private static final long SEEKER_PLUS_PRICE = 199L;

    @Autowired UserRepository users;

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

    /** Returns the display name, so a ledger assertion can isolate its row in a shared database. */
    private String subscribe(String mobile, String displayName, String planName, String status) {
        return subscribeAt(mobile, displayName, planName, status, null);
    }

    /**
     * As {@link #subscribe}, at an explicit price.
     *
     * <p>A null {@code amount} copies the catalogue, standing in for a purchase made at today's
     * price. Passing one that differs is how a test reaches the state a reprice produces — an
     * existing subscription whose charge no longer matches what the plan costs a new buyer —
     * without mutating a catalogue that every other test in this shared database also reads.
     */
    private String subscribeAt(String mobile, String displayName, String planName, String status,
            Long amount) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(displayName);
        u.setMobileVerified(true);
        UUID userId = users.saveAndFlush(u).getId();
        jdbc.update("""
                insert into subscriptions (user_id, plan_id, status, started_at, payment_ref, amount)
                select ?, p.id, ?, now(), ?, coalesce(?, p.price) from plans p where p.id = ?
                """, userId, status, "pay_" + mobile, amount, planId(planName));
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

    @Nested
    @DisplayName("the overview's models")
    class Models {

        @Test
        void aYearlyPlanContributesATwelfthOfItsPriceToMrr() throws Exception {
            String token = admin();
            long before = num(body(Routes.Admin.FINANCE, token), "$.mrr");

            subscribe("9877730010", "Yearly Member", "Owner Pro", "active");

            long after = num(body(Routes.Admin.FINANCE, token), "$.mrr");
            assertThat(after - before)
                    .as("one Owner Pro at ₹%d a year is ₹%d a month, not ₹%d",
                            OWNER_PRO_PRICE, OWNER_PRO_MONTHLY, OWNER_PRO_PRICE)
                    .isEqualTo(OWNER_PRO_MONTHLY);
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
         * Money follows the subscription, not the catalogue row it points at.
         *
         * <p>Until V37 there was no {@code subscriptions.amount} and every figure on this console
         * joined {@code plans.price} — the price <em>today</em>. Since the catalogue is seeded by a
         * repeatable migration whose upsert ends {@code price = EXCLUDED.price}, correcting a plan
         * rewrote what every subscription ever sold at the old price reported having earned,
         * including on the settlement ledger, where the figure has to equal what the gateway
         * captured. Nothing failed; the numbers were just wrong.
         *
         * <p>Asserted with a subscription whose amount differs from its plan's, which is the state
         * a reprice leaves behind — and reaching it this way rather than by editing the catalogue
         * keeps the test from disturbing every other reader of this shared database.
         */
        @Test
        void aRepricedPlanDoesNotRestateWhatWasAlreadySold() throws Exception {
            String token = admin();
            long before = num(body(Routes.Admin.FINANCE, token), "$.revenue");
            long soldAt = OWNER_PRO_PRICE * 2;

            subscribeAt("9877730013", "Old Price Member", "Owner Pro", "active", soldAt);

            assertThat(num(body(Routes.Admin.FINANCE, token), "$.revenue") - before)
                    .as("revenue is what this subscription was charged (₹%d), not what Owner Pro"
                            + " costs a new buyer today (₹%d)", soldAt, OWNER_PRO_PRICE)
                    .isEqualTo(soldAt);
        }

        /** MRR is {@code status = 'active'} while revenue is {@code status <> 'pending'}; the two
         *  are easy to collapse into one query by accident. */
        @Test
        void aCancelledSubscriptionLeavesMrrButStaysRevenue() throws Exception {
            String token = admin();
            String before = body(Routes.Admin.FINANCE, token);

            subscribe("9877730012", "Cancelled Member", "Owner Pro", "cancelled");

            String after = body(Routes.Admin.FINANCE, token);
            assertThat(num(after, "$.mrr") - num(before, "$.mrr"))
                    .as("a cancelled subscription bills nothing next month")
                    .isZero();
            assertThat(num(after, "$.revenue") - num(before, "$.revenue"))
                    .as("but it was paid for, so it is still revenue")
                    .isEqualTo(OWNER_PRO_PRICE);
        }

        /** Excluded by price, not by name, so a future zero-rupee plan needs no list updating. */
        @Test
        void aFreePlanIsNotRevenue() throws Exception {
            String token = admin();
            String before = body(Routes.Admin.FINANCE, token);

            subscribe("9877730013", "Free Member", "Owner Free", "active");

            String after = body(Routes.Admin.FINANCE, token);
            assertThat(num(after, "$.mrr") - num(before, "$.mrr")).isZero();
            assertThat(num(after, "$.revenue") - num(before, "$.revenue")).isZero();
        }

        /** Asserted over whatever the book contains, not a fixed list, so adding a plan keeps it honest. */
        @Test
        void thePlanLinesSumToMrr() throws Exception {
            String token = admin();
            subscribe("9877730014", "Book Member", "Owner Pro", "active");

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
                        if ("Owner Pro".equals(p.get("name"))) {
                            assertThat(((Number) p.get("price")).longValue())
                                    .isEqualTo(OWNER_PRO_PRICE);
                            assertThat(p.get("billingCycle")).isEqualTo("yearly");
                        }
                    });
        }

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

        /** An omitted empty bucket is invisible in a stacked bar chart — the bars simply close up,
         *  reading as an unbroken run of trading months that did not happen. */
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

        /** The band must be present and zero, and the disclosure flag asserted beside it: a
         *  structural zero with no flag is indistinguishable from a measured one. */
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

        /** The pin promised in {@code REVENUE_SERIES_BY_SOURCE}'s Javadoc: two independently
         *  written queries over the same sources must agree. */
        @Test
        void theCurrentMonthsBandsSumToTheOverviewsMonthRevenue() throws Exception {
            String token = admin();
            subscribe("9877730020", "Agreement Member", "Owner Pro", "active");

            String series = body(Routes.Admin.FINANCE_SERIES + "?months=1", token);
            long banded = num(series, "$[0].subscriptions")
                    + num(series, "$[0].featured") + num(series, "$[0].services");

            assertThat(banded)
                    .as("the chart and the headline tile describe the same month")
                    .isEqualTo(num(body(Routes.Admin.FINANCE, token), "$.monthRevenue"));
            assertThat(banded)
                    .as("and the fixture makes this a real comparison, not 0 == 0")
                    .isGreaterThanOrEqualTo(OWNER_PRO_PRICE);
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

        /** The ledger reconciles against a bank statement, which saw ₹2,499 leave an account once. */
        @Test
        void aSettledSubscriptionAppearsAtItsStickerPrice() throws Exception {
            String token = admin();
            String name = subscribe("9877730030", "Ledger Member", "Owner Pro", "active");

            mvc.perform(get(Routes.Admin.FINANCE_TRANSACTIONS)
                            .param("q", name)
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalElements").value(1))
                    .andExpect(jsonPath("$.content[0].kind").value("subscription"))
                    .andExpect(jsonPath("$.content[0].amount").value((int) OWNER_PRO_PRICE))
                    .andExpect(jsonPath("$.content[0].status").value("paid"))
                    .andExpect(jsonPath("$.content[0].party").value(name));
        }

        /** Otherwise every Owner Free signup is a ₹0 row burying the ones that matter. */
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

        /** An accepted-but-unmatchable filter returns an empty page, indistinguishable from a
         *  quarter in which nothing sold. */
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
            for (String kind : List.of("subscription", "featured")) {
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

        /** Contact details have no place on a finance ledger; the party is a name. */
        @Test
        void noRowCarriesAMobileNumber() throws Exception {
            String token = admin();
            subscribe("9877730032", "Privacy Member", "Owner Pro", "active");

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

        /** The series and the ledger expose the same revenue mix, so all three need the admin guard. */
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

