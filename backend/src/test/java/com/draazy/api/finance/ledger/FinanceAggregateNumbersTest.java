package com.draazy.api.finance.ledger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.PlatformTime;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

/** Pins every number {@code /summary} and {@code /cashflow} return for one awkward ledger. Dates derive from
 * {@link #thisMonth()} in {@link PlatformTime#IST}, the service's calendar. */
class FinanceAggregateNumbersTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    /** The month the <em>service</em> considers current — India's, not the host's. */
    private static YearMonth thisMonth() {
        return YearMonth.now(PlatformTime.IST);
    }

    // ---- the seeded ledger, stated once so the expected totals below can be read against it ----

    private static final long THIS_MONTH_INCOME = 100_000L;
    private static final long THIS_MONTH_EXPENSE = 40_000L;
    private static final long LAST_MONTH_INCOME = 500_000L;
    private static final long TWO_MONTHS_AGO_EXPENSE = 30_000L;
    private static final long FUTURE_INCOME = 777L;
    private static final long DELETED_INCOME = 999_999L;

    // ---- helpers ----

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Aggregate Owner " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "Aggregate listing", "rent", "apartment",
                25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private String addTxn(User owner, Property p, String type, long amount, LocalDate date)
            throws Exception {
        MvcResult result = mvc.perform(post("/me/finances/" + p.getId() + "/transactions")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"" + type + "\",\"amount\":" + amount
                                + ",\"date\":\"" + date + "\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        return result.getResponse().getContentAsString()
                .replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    /** Rows sit on the 1st, the boundary: {@code date >= from} is inclusive and an off-by-one would drop them. */
    private void seed(User owner, Property p) throws Exception {
        YearMonth thisMonth = thisMonth();

        addTxn(owner, p, TransactionTypes.INCOME, THIS_MONTH_INCOME, thisMonth.atDay(1));
        addTxn(owner, p, TransactionTypes.EXPENSE, THIS_MONTH_EXPENSE, thisMonth.atDay(1));
        addTxn(owner, p, TransactionTypes.INCOME, LAST_MONTH_INCOME,
                thisMonth.minusMonths(1).atDay(15));
        addTxn(owner, p, TransactionTypes.EXPENSE, TWO_MONTHS_AGO_EXPENSE,
                thisMonth.minusMonths(2).atDay(10));
        addTxn(owner, p, TransactionTypes.INCOME, FUTURE_INCOME,
                thisMonth.plusMonths(2).atDay(5));

        // Soft-deleted: recorded, then removed. It must appear in no aggregate and in no month.
        String doomed = addTxn(owner, p, TransactionTypes.INCOME, DELETED_INCOME,
                thisMonth.atDay(1));
        mvc.perform(delete("/me/finances/" + p.getId() + "/transactions/" + doomed)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());
    }

    // ---- 1: /summary?period=all ----

    /** No {@code period} at all must be identical to {@code period=all} - the documented default. */
    @ParameterizedTest(name = "summary{0} counts every live row including future-dated ones")
    @ValueSource(strings = {"?period=all", ""})
    void summary_allTime_countsEveryLiveRowIncludingFutureDatedOnes(String query) throws Exception {
        User owner = owner("9832100001");
        Property p = listing(owner);
        seed(owner, p);

        long income = THIS_MONTH_INCOME + LAST_MONTH_INCOME + FUTURE_INCOME;
        long expense = THIS_MONTH_EXPENSE + TWO_MONTHS_AGO_EXPENSE;

        mvc.perform(get("/me/finances/" + p.getId() + "/summary" + query)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.income").value(income))
                .andExpect(jsonPath("$.expense").value(expense))
                .andExpect(jsonPath("$.net").value(income - expense));
    }

    // ---- 2: /summary?period=month — a lower bound only, so the future row still counts ----

    @Test
    void summary_month_isLowerBoundedOnly_soTheFutureRowStillCounts() throws Exception {
        User owner = owner("9832100003");
        Property p = listing(owner);
        seed(owner, p);

        // The window is `date >= 1st of this month` with no upper bound. Last month's income and
        // the older expense fall out; the post-dated row does not.
        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=month")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.income").value(THIS_MONTH_INCOME + FUTURE_INCOME))
                .andExpect(jsonPath("$.expense").value(THIS_MONTH_EXPENSE))
                .andExpect(jsonPath("$.net")
                        .value(THIS_MONTH_INCOME + FUTURE_INCOME - THIS_MONTH_EXPENSE));
    }

    // ---- 3: /cashflow — the series, its length, and its zero-filled gaps ----

    @Test
    void cashflow_bucketsByMonth_andEndsWithThisMonth() throws Exception {
        User owner = owner("9832100004");
        Property p = listing(owner);
        seed(owner, p);

        YearMonth thisMonth = thisMonth();

        mvc.perform(get("/me/finances/" + p.getId() + "/overview?months=3")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cashflow.length()").value(3))
                // oldest first: two months ago, carrying only the expense
                .andExpect(jsonPath("$.cashflow[0].month").value(thisMonth.minusMonths(2).toString()))
                .andExpect(jsonPath("$.cashflow[0].income").value(0))
                .andExpect(jsonPath("$.cashflow[0].expense").value(TWO_MONTHS_AGO_EXPENSE))
                .andExpect(jsonPath("$.cashflow[0].net").value(-TWO_MONTHS_AGO_EXPENSE))
                // last month
                .andExpect(jsonPath("$.cashflow[1].month").value(thisMonth.minusMonths(1).toString()))
                .andExpect(jsonPath("$.cashflow[1].income").value(LAST_MONTH_INCOME))
                .andExpect(jsonPath("$.cashflow[1].expense").value(0))
                .andExpect(jsonPath("$.cashflow[1].net").value(LAST_MONTH_INCOME))
                // this month: the deleted row is absent from the bucket
                .andExpect(jsonPath("$.cashflow[2].month").value(thisMonth.toString()))
                .andExpect(jsonPath("$.cashflow[2].income").value(THIS_MONTH_INCOME))
                .andExpect(jsonPath("$.cashflow[2].expense").value(THIS_MONTH_EXPENSE))
                .andExpect(jsonPath("$.cashflow[2].net").value(THIS_MONTH_INCOME - THIS_MONTH_EXPENSE));
    }

    /** The chart series stops at this month, so the post-dated row is hidden though {@code /summary} counts it. */
    @Test
    void cashflow_neverEmitsAMonthBeyondThisOne() throws Exception {
        User owner = owner("9832100005");
        Property p = listing(owner);
        seed(owner, p);

        String body = mvc.perform(get("/me/finances/" + p.getId() + "/overview?months=12")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cashflow.length()").value(12))
                .andExpect(jsonPath("$.cashflow[11].month").value(thisMonth().toString()))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain(thisMonth().plusMonths(2).toString());
        assertThat(body).doesNotContain(String.valueOf(FUTURE_INCOME));
    }

    /** Months with no rows are emitted as zero points, not skipped — a gap is a different chart. */
    @Test
    void cashflow_emitsZeroPointsForMonthsWithNoRows() throws Exception {
        User owner = owner("9832100006");
        Property p = listing(owner);
        seed(owner, p);

        YearMonth thisMonth = thisMonth();

        mvc.perform(get("/me/finances/" + p.getId() + "/overview?months=5")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cashflow.length()").value(5))
                .andExpect(jsonPath("$.cashflow[0].month").value(thisMonth.minusMonths(4).toString()))
                .andExpect(jsonPath("$.cashflow[0].income").value(0))
                .andExpect(jsonPath("$.cashflow[0].expense").value(0))
                .andExpect(jsonPath("$.cashflow[0].net").value(0))
                .andExpect(jsonPath("$.cashflow[1].month").value(thisMonth.minusMonths(3).toString()))
                .andExpect(jsonPath("$.cashflow[1].income").value(0))
                .andExpect(jsonPath("$.cashflow[1].expense").value(0))
                .andExpect(jsonPath("$.cashflow[1].net").value(0));
    }

    // ---- 4: an empty ledger is a well-formed answer, not a null or a 404 ----

    @Test
    void emptyLedger_summaryIsZeroed_andCashflowIsAllZeroPoints() throws Exception {
        User owner = owner("9832100007");
        Property p = listing(owner);

        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=all")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.income").value(0))
                .andExpect(jsonPath("$.expense").value(0))
                .andExpect(jsonPath("$.net").value(0));

        mvc.perform(get("/me/finances/" + p.getId() + "/overview?months=2")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cashflow.length()").value(2))
                .andExpect(jsonPath("$.cashflow[0].income").value(0))
                .andExpect(jsonPath("$.cashflow[0].expense").value(0))
                .andExpect(jsonPath("$.cashflow[0].net").value(0))
                .andExpect(jsonPath("$.cashflow[1].income").value(0))
                .andExpect(jsonPath("$.cashflow[1].expense").value(0))
                .andExpect(jsonPath("$.cashflow[1].net").value(0));
    }

    // ---- 5: signs. The API refuses a negative; the sum, if one exists, is verbatim ----

    @Test
    void addTransaction_rejectsANegativeAmount() throws Exception {
        User owner = owner("9832100008");
        Property p = listing(owner);

        // A refund is an `income` row, not a negative `expense` — direction lives in `type`
        // (TransactionCreateRequest). Pinned so nobody "fixes" the aggregate to handle signs.
        mvc.perform(post("/me/finances/" + p.getId() + "/transactions")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"expense\",\"amount\":-5000,\"date\":\""
                                + LocalDate.now(PlatformTime.IST) + "\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    /** Inserted via JDBC since the API refuses it: a negative amount must be summed as written. */
    @Test
    void aggregates_sumTheColumnVerbatim_evenWhenARowIsNegative() throws Exception {
        User owner = owner("9832100009");
        Property p = listing(owner);
        addTxn(owner, p, TransactionTypes.EXPENSE, THIS_MONTH_EXPENSE, thisMonth().atDay(1));

        jdbc.update("insert into transactions "
                        + "(id, property_id, owner_id, type, amount, date, recurring, archived) "
                        + "values (?, ?, ?, 'expense', -5000, ?, 'none', false)",
                UUID.randomUUID(), p.getId(), owner.getId(), thisMonth().atDay(1));

        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=all")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.expense").value(THIS_MONTH_EXPENSE - 5000))
                .andExpect(jsonPath("$.net").value(-(THIS_MONTH_EXPENSE - 5000)));

        mvc.perform(get("/me/finances/" + p.getId() + "/overview?months=1")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cashflow[0].expense").value(THIS_MONTH_EXPENSE - 5000));
    }

    // ---- 6: another owner's numbers stay another owner's ----

    @Test
    void aggregates_areScopedToTheCallersOwnProperty() throws Exception {
        User owner = owner("9832100010");
        User stranger = owner("9832100011");
        Property p = listing(owner);
        seed(owner, p);

        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=all")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/me/finances/" + p.getId() + "/overview?months=3")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    /** A second property's ledger must not bleed into the first one's totals. */
    @Test
    void aggregates_doNotMixTwoPropertiesOfTheSameOwner() throws Exception {
        User owner = owner("9832100012");
        Property first = listing(owner);
        Property second = listing(owner);
        seed(owner, first);
        addTxn(owner, second, TransactionTypes.INCOME, 1_234L, thisMonth().atDay(1));

        mvc.perform(get("/me/finances/" + second.getId() + "/summary?period=all")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.income").value(1_234))
                .andExpect(jsonPath("$.expense").value(0));

        mvc.perform(get("/me/finances/" + first.getId() + "/summary?period=all")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.income")
                        .value(THIS_MONTH_INCOME + LAST_MONTH_INCOME + FUTURE_INCOME));
    }

    // ---- 7: the index the aggregates are only cheap because of ----

    /** Asserted on {@code pg_indexes}: the V51 covering index leaves no trace in results if dropped. */
    @Test
    void v51_coveringIndexExists_andCarriesTheColumnsTheAggregatesSum() {
        var defs = jdbc.queryForList(
                "select indexdef from pg_indexes where indexname = ?",
                String.class, "idx_transactions_property_agg");

        assertThat(defs).hasSize(1);
        assertThat(defs.getFirst())
                .contains("property_id")      // the equality, leading
                .contains("date")             // the range both windows are expressed on
                .contains("INCLUDE")          // payload, so the sum needs no heap visit
                .contains("type")
                .contains("amount")
                .contains("archived = false"); // partial: no read here ever wants an archived row

        // The old V12's index had the same key and was replaced, not kept alongside. Two indexes the
        // planner cannot tell apart are paid for on every write and chosen for nothing.
        assertThat(jdbc.queryForList(
                "select indexdef from pg_indexes where indexname = ?",
                String.class, "idx_transactions_property")).isEmpty();
    }
}
