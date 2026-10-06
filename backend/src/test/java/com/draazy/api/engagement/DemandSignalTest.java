package com.draazy.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
import jakarta.persistence.EntityManager;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/** Demand signals: the anonymous half of the supply-gap report. The write must work without a token, or it misses
 * the population it measures; the read stays non-public. */
@DisplayName("demand signals feed the supply-gap report")
class DemandSignalTest extends AbstractApiTest {

    /** A slug no seed row uses, so counts in this class cannot drift with the fixtures. */
    private static final String LOCALITY = "d10-demand-locality";

    /** Deliberately never inserted into `localities` — see theUnknownLocalityIsTheInterestingRow. */
    private static final String UNKNOWN = "d10-nowhere-at-all";

    @Autowired
    UserRepository users;

    @Autowired
    EntityManager em;

    private void locality() {
        jdbc.update("""
                insert into localities (slug, name, city, active)
                values (?, ?, ?, true)
                on conflict (slug) do nothing
                """, LOCALITY, "D10 Demand Locality", "Pune");
    }

    private int signalsFor(String slug) {
        Integer n = jdbc.queryForObject(
                "select count(*) from demand_signals where locality_slug = ?", Integer.class, slug);
        return n == null ? 0 : n;
    }

    /** The JPA save is unflushed and {@code jdbc} reads don't flush, so flush before counting. */
    private void send(String body) throws Exception {
        mvc.perform(post("/demand-signals").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isAccepted());
        em.flush();
    }

    @Test
    @DisplayName("a signed-out visitor's search is recorded")
    void theWriteIsAnonymous() throws Exception {
        send("{\"kind\":\"search\",\"localitySlug\":\"" + LOCALITY + "\",\"deal\":\"rent\"}");

        assertThat(signalsFor(LOCALITY)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "select user_id from demand_signals where locality_slug = ?", Object.class, LOCALITY))
                .as("no session, so no user — and that is the common case, not a failure")
                .isNull();
    }

    @Test
    @DisplayName("a signed-in visitor's signal carries the user, so repeat interest is separable")
    void aSignedInVisitorIsAttributed() throws Exception {
        User u = new User("9820950001", "buyer");
        u.setMobileVerified(true);
        u = users.saveAndFlush(u);

        mvc.perform(post("/demand-signals")
                        .header("Authorization", bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"view\",\"localitySlug\":\"" + LOCALITY + "\"}"))
                .andExpect(status().isAccepted());
        em.flush();

        assertThat(jdbc.queryForObject(
                "select user_id from demand_signals where locality_slug = ?", Object.class, LOCALITY))
                .isEqualTo(u.getId());
    }

    @Test
    @DisplayName("the aggregate is not readable without back-office rights")
    void theReadIsNotPublic() throws Exception {
        mvc.perform(get("/admin/supply-gap")).andExpect(status().isUnauthorized());

        User buyer = new User("9820950002", "buyer");
        buyer.setMobileVerified(true);
        buyer = users.saveAndFlush(buyer);
        mvc.perform(get("/admin/supply-gap").header("Authorization", bearer(buyer)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("an unrecognised kind is refused rather than stored")
    void theKindIsConstrained() throws Exception {
        mvc.perform(post("/demand-signals").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"purchase\",\"localitySlug\":\"" + LOCALITY + "\"}"))
                .andExpect(status().isUnprocessableEntity());

        assertThat(signalsFor(LOCALITY)).isZero();
    }

    @Test
    @DisplayName("an empty locality is stored as absent, not as a place named nothing")
    void blankLocalityBecomesNull() throws Exception {
        send("{\"kind\":\"search\",\"localitySlug\":\"\"}");

        assertThat(signalsFor("")).as("no row should be filed under the empty string").isZero();
        Integer nulls = jdbc.queryForObject(
                "select count(*) from demand_signals where locality_slug is null", Integer.class);
        assertThat(nulls).isEqualTo(1);
    }

    @Test
    @DisplayName("the table holds no contact detail, by design")
    void noContactDetailIsStored() {
        Integer contactColumns = jdbc.queryForObject("""
                select count(*) from information_schema.columns
                where table_name = 'demand_signals'
                  and column_name in ('mobile', 'email', 'phone', 'contact')
                """, Integer.class);

        assertThat(contactColumns)
                .as("the client used to send a mobile with every alert signal. It is not stored: "
                        + "the only reader is a count, so a contact detail here would be data held "
                        + "on people who never opened an account, for a report that cannot use it.")
                .isZero();
    }

    @Test
    @DisplayName("demand is weighted by kind, and a view is not demand")
    void demandIsWeightedByKind() throws Exception {
        locality();
        send("{\"kind\":\"view\",\"localitySlug\":\"" + LOCALITY + "\"}");
        send("{\"kind\":\"search\",\"localitySlug\":\"" + LOCALITY + "\"}");
        send("{\"kind\":\"alert\",\"localitySlug\":\"" + LOCALITY + "\"}");

        // 1 search (x2) + 1 alert (x5) = 7; views are not counted as they grow with supply.
        // Hamcrest `contains`, as a filtered JSONPath yields an array even for one row.
        mvc.perform(get("/admin/supply-gap").header("Authorization", bearer(admin())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.localitySlug=='" + LOCALITY + "')].searches")
                        .value(Matchers.contains(1)))
                .andExpect(jsonPath("$[?(@.localitySlug=='" + LOCALITY + "')].alerts")
                        .value(Matchers.contains(1)))
                .andExpect(jsonPath("$[?(@.localitySlug=='" + LOCALITY + "')].views")
                        .value(Matchers.contains(1)))
                .andExpect(jsonPath("$[?(@.localitySlug=='" + LOCALITY + "')].demand")
                        .value(Matchers.contains(7)))
                .andExpect(jsonPath("$[?(@.localitySlug=='" + LOCALITY + "')].demandPerListing")
                        .value(Matchers.contains(7.0)));
    }

    @Test
    @DisplayName("rows rank by demand per listing, and the row with no locality ranks last")
    void rowsRankByDemandPerListing() throws Exception {
        locality();
        send("{\"kind\":\"search\",\"localitySlug\":\"" + LOCALITY + "\"}");
        for (int i = 0; i < 5; i++) {
            send("{\"kind\":\"alert\"}");
        }

        String json = mvc.perform(get("/admin/supply-gap").header("Authorization", bearer(admin())))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<Map<String, Object>> rows = JsonPath.read(json, "$[*]");

        assertThat(rows.get(rows.size() - 1))
                .as("nowhere to source supply for, so it is not a ranking candidate")
                .doesNotContainKey("localitySlug");
        assertThat(rows.subList(0, rows.size() - 1).stream()
                        .map(r -> ((Number) r.get("demandPerListing")).doubleValue()).toList())
                .isSortedAccordingTo(Comparator.reverseOrder());
    }

    @Test
    @DisplayName("a locality nobody has heard of is reported, not dropped")
    void theUnknownLocalityIsTheInterestingRow() throws Exception {
        send("{\"kind\":\"alert\",\"localitySlug\":\"" + UNKNOWN + "\"}");

        // No `localities` row means no foreign key: someone asking for uncovered ground, which a FK would reject.
        mvc.perform(get("/admin/supply-gap").header("Authorization", bearer(admin())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.localitySlug=='" + UNKNOWN + "')].alerts")
                        .value(Matchers.contains(1)))
                .andExpect(jsonPath("$[?(@.localitySlug=='" + UNKNOWN + "')].supply")
                        .value(Matchers.contains(0)))
                // NON_NULL omits localityName entirely, so the filtered selection is empty rather
                // than a list holding null -- the response does not advertise a field it withheld.
                .andExpect(jsonPath("$[?(@.localitySlug=='" + UNKNOWN + "')].localityName")
                        .value(Matchers.empty()));
    }

    @Test
    @DisplayName("an absurd window is refused rather than served slowly")
    void theWindowIsBounded() throws Exception {
        mvc.perform(get("/admin/supply-gap").param("days", "4000")
                        .header("Authorization", bearer(admin())))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("repeat seekers count sessions that can be told apart, not anonymous searches")
    void repeatSeekersAreSignedInOnly() throws Exception {
        locality();
        User keen = new User("9820950003", "buyer");
        keen.setMobileVerified(true);
        keen = users.saveAndFlush(keen);

        String body = "{\"kind\":\"search\",\"localitySlug\":\"" + LOCALITY + "\"}";
        for (int i = 0; i < 3; i++) {
            mvc.perform(post("/demand-signals").header("Authorization", bearer(keen))
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isAccepted());
        }
        // Four anonymous searches add to `searches` only: nothing distinguishes four strangers from one seeker.
        for (int i = 0; i < 4; i++) {
            send(body);
        }
        em.flush();

        mvc.perform(get("/admin/supply-gap").header("Authorization", bearer(admin())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.localitySlug=='" + LOCALITY + "')].searches")
                        .value(Matchers.contains(7)))
                .andExpect(jsonPath("$[?(@.localitySlug=='" + LOCALITY + "')].repeatSeekers")
                        .value(Matchers.contains(1)));
    }

    private User admin() {
        User a = new User("9820959999", "admin");
        a.setMobileVerified(true);
        return users.saveAndFlush(a);
    }
}
