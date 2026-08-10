package com.punenest.api.finance.ledger;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.PlatformTime;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.JwtService;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * Contract + behaviour proof for the finance ledger (S5.3), driven through the real filter chain
 * against the live Flyway'd Postgres under {@code ddl-auto=validate}.
 *
 * <p>Covers the §11 bar for this surface: owner scoping (404 never 403), whole-rupee money, PATCH
 * partial-update semantics (spec fix S19), soft-delete — the row leaves the ledger and the totals
 * but survives in the table, summary period windows (spec fix S18), the nullable occupancy rate
 * (spec fix S20), the recurring dues projection, and route-constant agreement.
 */
class FinanceEndpointsTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager em;
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping handlerMapping;

    // ---- helpers ----

    /**
     * Push pending JPA writes to the database.
     *
     * <p>The test method and the request handler share one transaction, but not one view of it:
     * {@code save()} only queues an insert in the persistence context, so a {@link JdbcTemplate}
     * read issued afterwards goes straight to a table that has not been written yet and sees
     * nothing. Every assertion below that reads a raw column flushes first.
     */
    private void flush() {
        em.flush();
    }

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Finance User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "Ledger listing", "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private String txnPath(Property p) {
        return "/me/finances/" + p.getId() + "/transactions";
    }

    /** Post a transaction and return its id, using the same extraction idiom as the deals tests. */
    private String addTxn(User owner, Property p, String body) throws Exception {
        MvcResult result = mvc.perform(post(txnPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn();
        return result.getResponse().getContentAsString()
                .replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    private String today() {
        return today.toString();
    }

    /**
     * The date the <em>service</em> considers today — India's, not the host's (D174).
     *
     * <p>A bare {@code LocalDate.now()} here would disagree with the server for the first 5.5 hours
     * of every Indian day on a UTC host, and the period windows below would start failing at
     * midnight IST for reasons that have nothing to do with the contract they are pinning.
     */
    private static final LocalDate today = LocalDate.now(PlatformTime.IST);

    // ---- 1: a ledger row round-trips with money intact ----

    @Test
    void addTransaction_returns201_andRoundTripsWholeRupees() throws Exception {
        User owner = user("9821100001");
        Property p = listing(owner);

        mvc.perform(post(txnPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"income\",\"category\":\"Rent\",\"amount\":2500000,"
                                + "\"date\":\"" + today() + "\",\"note\":\"March rent\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(2500000))
                .andExpect(jsonPath("$.type").value(TransactionTypes.INCOME))
                .andExpect(jsonPath("$.propertyId").value(p.getId().toString()));

        // Money is bigint end to end: read it from the column rather than the JSON, so a float
        // anywhere in the stack would show up here as a changed value.
        flush();
        Long stored = jdbc.queryForObject(
                "select amount from transactions where property_id = ?", Long.class, p.getId());
        assertThat(stored).isEqualTo(2_500_000L);
    }

    // ---- 2: another owner's ledger is 404, never 403 ----

    @Test
    void listTransactions_nonOwner_returns404NotForbidden() throws Exception {
        User owner = user("9821100002");
        User stranger = user("9821100003");
        Property p = listing(owner);

        mvc.perform(get(txnPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    @Test
    void addTransaction_nonOwner_returns404NotForbidden() throws Exception {
        User owner = user("9821100004");
        User stranger = user("9821100005");
        Property p = listing(owner);

        mvc.perform(post(txnPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"income\",\"category\":\"Rent\",\"amount\":100,"
                                + "\"date\":\"" + today() + "\"}"))
                .andExpect(status().isNotFound());
    }

    // ---- 3: a malformed property id is 404, not 400 ----

    @Test
    void malformedPropertyId_returns404() throws Exception {
        User owner = user("9821100006");

        mvc.perform(get("/me/finances/not-a-uuid/transactions")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());
    }

    // ---- 4: PATCH is a genuine partial update (spec fix S19) ----

    @Test
    void updateTransaction_absentFieldsAreLeftAlone() throws Exception {
        User owner = user("9821100007");
        Property p = listing(owner);
        String id = addTxn(owner, p, "{\"type\":\"expense\",\"category\":\"Repairs\","
                + "\"amount\":500000,\"date\":\"" + today() + "\",\"note\":\"Plumbing\"}");

        // Send only the amount. Before S19 this shape was a 422: the schema required type, amount
        // and date, which made PATCH a PUT wearing a PATCH's name.
        mvc.perform(patch(txnPath(p) + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"amount\":600000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.amount").value(600000))
                .andExpect(jsonPath("$.category").value("Repairs"))
                .andExpect(jsonPath("$.note").value("Plumbing"))
                .andExpect(jsonPath("$.type").value(TransactionTypes.EXPENSE));
    }

    @Test
    void updateTransaction_unknownId_returns404() throws Exception {
        User owner = user("9821100008");
        Property p = listing(owner);

        mvc.perform(patch(txnPath(p) + "/" + UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"amount\":1}"))
                .andExpect(status().isNotFound());
    }

    // ---- 5: delete is soft — gone from the ledger and the totals, still in the table ----

    @Test
    void deleteTransaction_isSoftAndLeavesTheAggregates() throws Exception {
        User owner = user("9821100009");
        Property p = listing(owner);
        String id = addTxn(owner, p, "{\"type\":\"income\",\"category\":\"Rent\","
                + "\"amount\":300000,\"date\":\"" + today() + "\"}");

        mvc.perform(delete(txnPath(p) + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());

        mvc.perform(get(txnPath(p)).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));

        // The row survives — an owner reconciling against a bank statement must still be able to
        // answer "where did that go", which a hard delete makes impossible.
        flush();
        Integer rows = jdbc.queryForObject(
                "select count(*) from transactions where id = ?", Integer.class, UUID.fromString(id));
        assertThat(rows).isEqualTo(1);
        Boolean archived = jdbc.queryForObject(
                "select archived from transactions where id = ?", Boolean.class, UUID.fromString(id));
        assertThat(archived).isTrue();

        // ...and must not still be counted.
        mvc.perform(get("/me/finances/" + p.getId() + "/summary")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.income").value(0));
    }

    // ---- 6: the summary aggregates, and honours the period window (spec fix S18) ----

    @Test
    void summary_aggregatesIncomeExpenseAndNet() throws Exception {
        User owner = user("9821100010");
        Property p = listing(owner);
        addTxn(owner, p, "{\"type\":\"income\",\"category\":\"Rent\",\"amount\":3000000,"
                + "\"date\":\"" + today() + "\"}");
        addTxn(owner, p, "{\"type\":\"expense\",\"category\":\"Repairs\",\"amount\":1000000,"
                + "\"date\":\"" + today() + "\"}");

        mvc.perform(get("/me/finances/" + p.getId() + "/summary")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.income").value(3000000))
                .andExpect(jsonPath("$.expense").value(1000000))
                .andExpect(jsonPath("$.net").value(2000000));
    }

    @Test
    void summary_periodMonth_excludesOlderRows() throws Exception {
        User owner = user("9821100011");
        Property p = listing(owner);
        addTxn(owner, p, "{\"type\":\"income\",\"category\":\"Rent\",\"amount\":900000,"
                + "\"date\":\"" + today() + "\"}");
        addTxn(owner, p, "{\"type\":\"income\",\"category\":\"Rent\",\"amount\":700000,"
                + "\"date\":\"" + today.minusMonths(6) + "\"}");

        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=all")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.income").value(1600000));

        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=month")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.income").value(900000));
    }

    /**
     * The UI has always offered "This quarter" and "This year", and the mock silently returned
     * all-time for both. This is the regression guard for that fix.
     */
    @Test
    void summary_quarterAndYear_areRealWindowsNotAllTime() throws Exception {
        User owner = user("9821100012");
        Property p = listing(owner);
        addTxn(owner, p, "{\"type\":\"income\",\"category\":\"Rent\",\"amount\":500000,"
                + "\"date\":\"" + today() + "\"}");
        addTxn(owner, p, "{\"type\":\"income\",\"category\":\"Rent\",\"amount\":400000,"
                + "\"date\":\"" + today.minusYears(3) + "\"}");

        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=quarter")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.income").value(500000));

        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=year")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.income").value(500000));
    }

    @Test
    void summary_rejectsAnUnknownPeriod() throws Exception {
        User owner = user("9821100013");
        Property p = listing(owner);

        mvc.perform(get("/me/finances/" + p.getId() + "/summary?period=fortnight")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isBadRequest());
    }

    // ---- 7: occupancyRate is null, not zero, for a property never let (spec fix S20) ----

    @Test
    void summary_occupancyRate_isNullWhenNeverLet() throws Exception {
        User owner = user("9821100014");
        Property p = listing(owner);

        // 0.0 would assert "vacant the whole window" about a flat that was never let at all — a
        // different and false claim.
        mvc.perform(get("/me/finances/" + p.getId() + "/summary")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.occupancyRate").doesNotExist());
    }

    // ---- 8: the basis upserts rather than accumulating rows ----

    @Test
    void basis_putThenGet_roundTripsAndUpserts() throws Exception {
        User owner = user("9821100015");
        Property p = listing(owner);

        mvc.perform(put("/me/finances/" + p.getId() + "/basis")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"purchasePrice\":8500000,\"purchaseDate\":\"2020-06-01\","
                                + "\"loanOutstanding\":4200000,\"emi\":45000,\"currentValue\":11000000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.purchasePrice").value(8500000));

        mvc.perform(put("/me/finances/" + p.getId() + "/basis")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"purchasePrice\":9000000}"))
                .andExpect(status().isOk());

        mvc.perform(get("/me/finances/" + p.getId() + "/basis")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.purchasePrice").value(9000000));

        // property_id is the primary key, so a second PUT cannot mean a second basis.
        flush();
        Integer rows = jdbc.queryForObject(
                "select count(*) from ownership_basis where property_id = ?", Integer.class, p.getId());
        assertThat(rows).isEqualTo(1);
    }

    @Test
    void basis_nonOwner_returns404() throws Exception {
        User owner = user("9821100016");
        User stranger = user("9821100017");
        Property p = listing(owner);

        mvc.perform(get("/me/finances/" + p.getId() + "/basis")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    // ---- 9: dues project recurring rows forward; one-off rows never appear ----

    @Test
    void dues_projectRecurringRowsOnly() throws Exception {
        User owner = user("9821100018");
        Property p = listing(owner);
        addTxn(owner, p, "{\"type\":\"expense\",\"category\":\"Maintenance\",\"amount\":250000,"
                + "\"date\":\"" + today.minusMonths(2) + "\",\"recurring\":\"monthly\"}");
        addTxn(owner, p, "{\"type\":\"expense\",\"category\":\"Repairs\",\"amount\":100000,"
                + "\"date\":\"" + today.minusMonths(2) + "\"}");

        mvc.perform(get("/me/finances/" + p.getId() + "/dues")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].category").value("Maintenance"))
                .andExpect(jsonPath("$[0].nextDue").exists())
                .andExpect(jsonPath("$[0].daysUntil").exists());
    }

    // ---- 10: cashflow returns the requested number of months, gaps filled with zeros ----

    @Test
    void cashflow_returnsRequestedMonthsWithGapsFilled() throws Exception {
        User owner = user("9821100019");
        Property p = listing(owner);
        addTxn(owner, p, "{\"type\":\"income\",\"category\":\"Rent\",\"amount\":2500000,"
                + "\"date\":\"" + today() + "\"}");

        // A chart with a missing bar is a different picture from one with a zero bar, so quiet
        // months must still be emitted.
        mvc.perform(get("/me/finances/" + p.getId() + "/cashflow?months=3")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[2].income").value(2500000))
                .andExpect(jsonPath("$[0].income").value(0));
    }

    @Test
    void cashflow_rejectsAnOutOfRangeWindow() throws Exception {
        User owner = user("9821100020");
        Property p = listing(owner);

        mvc.perform(get("/me/finances/" + p.getId() + "/cashflow?months=600")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isBadRequest());
    }

    // ---- 11: the ledger is per-property, not per-owner ----

    @Test
    void listTransactions_isScopedToOneProperty() throws Exception {
        User owner = user("9821100021");
        Property a = listing(owner);
        Property b = listing(owner);
        addTxn(owner, a, "{\"type\":\"income\",\"category\":\"Rent\",\"amount\":111,"
                + "\"date\":\"" + today() + "\"}");
        addTxn(owner, b, "{\"type\":\"income\",\"category\":\"Rent\",\"amount\":222,"
                + "\"date\":\"" + today() + "\"}");

        mvc.perform(get(txnPath(a)).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].amount").value(111));
    }

    // ---- 11b: the ledger is paged, and a hostile page size is clamped ----

    /**
     * A property ledger grows on a schedule and is never culled, so it is paged (api-standards.md
     * §5.1). Two things are asserted that a refactor could silently break: the response is the
     * {@code PageEnvelope} the contract now declares rather than a bare array, and an absurd
     * {@code size} is clamped by {@code spring.data.web.pageable.max-page-size} instead of being
     * honoured — an owner with years of history is otherwise a one-request memory spike.
     *
     * <p>The {@code sort} parameter is deliberately hostile: the operation declares no sort, so the
     * controller must drop it. Passing it through would reach the query as an unknown property and
     * surface as a 500.
     */
    @Test
    void listTransactions_isPagedAndClampsPageSize() throws Exception {
        User owner = user("9821100031");
        Property p = listing(owner);
        addTxn(owner, p, "{\"type\":\"income\",\"category\":\"Rent\",\"amount\":100,"
                + "\"date\":\"" + today() + "\"}");
        addTxn(owner, p, "{\"type\":\"expense\",\"category\":\"Repair\",\"amount\":50,"
                + "\"date\":\"" + today() + "\"}");

        mvc.perform(get(txnPath(p) + "?page=0&size=1")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.page").value(0));

        mvc.perform(get(txnPath(p) + "?size=100000&sort=nosuchfield,desc")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100))
                .andExpect(jsonPath("$.content.length()").value(2));
    }

    // ---- 12: an unauthenticated caller gets 401, not a ledger ----
    @Test
    void ledgerRequiresAuthentication() throws Exception {
        User owner = user("9821100022");
        Property p = listing(owner);

        mvc.perform(get(txnPath(p)))
                .andExpect(status().isUnauthorized());
    }

    // ---- 13: an unknown transaction type is rejected, not stored ----

    @Test
    void addTransaction_rejectsAnUnknownType() throws Exception {
        User owner = user("9821100023");
        Property p = listing(owner);

        mvc.perform(post(txnPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"refund\",\"amount\":100,\"date\":\"" + today() + "\"}"))
                .andExpect(status().isBadRequest());
    }

    // ---- 14: route-constant ↔ handler-mapping agreement ----

    @Test
    void everyFinanceRouteConstantIsServedByAController() {
        Set<String> mapped = handlerMapping.getHandlerMethods().keySet().stream()
                .filter(info -> info.getPathPatternsCondition() != null)
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream())
                .collect(Collectors.toSet());

        assertThat(mapped).contains(
                Routes.Finances.TRANSACTIONS,
                Routes.Finances.TRANSACTION_BY_ID,
                Routes.Finances.BASIS,
                Routes.Finances.SUMMARY,
                Routes.Finances.CASHFLOW,
                Routes.Finances.DUES);
    }
}
