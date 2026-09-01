package com.draazy.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/**
 * Demand signals: the anonymous half of the supply-gap report.
 *
 * <p><strong>What was wrong.</strong> The Supply-Gap tab was assembled in the browser from four
 * localStorage arrays. Three call sites appended to them — a search, a "notify me" submit and a
 * property view — and the admin report read them back. Since localStorage is per browser, the
 * report described the searches performed by the administrator reading it, in that browser, since
 * storage was last cleared. The only column with any breadth was 82 invented enquiry rows. Demand
 * is the one quantity that is meaningless unless it aggregates across everybody, so it was the one
 * that could least afford to live in a single session.
 *
 * <p><strong>Why the anonymous write is tested first and hardest.</strong> Opening an unauthenticated
 * POST is the part of this change that could go wrong quietly. {@link #theWriteIsAnonymous} pins
 * that it works without a token — because a demand report that only hears from signed-in visitors
 * has lost exactly the population it exists to measure — and {@link #theReadIsNotPublic} pins that
 * the read did <em>not</em> come along for the ride. Those two run in opposite directions on the
 * same feature and are the pair worth keeping.
 *
 * <p><strong>Why no contact detail is asserted as absent.</strong> {@link #noContactDetailIsStored}
 * is a schema assertion rather than a behavioural one, and it is deliberate: the client used to send
 * a mobile number with every alert signal, and the easiest possible "fix" to a future bug report is
 * to add the column back. The test states the reason so that the next person has to argue with it.
 *
 * <p>Rows are counted through {@code jdbc} so the assertions are about what reached the table.
 *
 * <p>Fixtures: a locality inserted inline; nothing here depends on the seed.
 */
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

    /**
     * The write is a JPA {@code save} inside the test's own transaction, so the INSERT is still
     * sitting in the persistence context when the request returns. The assertions below read with
     * {@code jdbc}, which does not trigger a Hibernate flush the way a JPA query does -- so without
     * this the raw counts would be zero while the HTTP reads in the same class saw the rows, which
     * is a confusing way to learn about flush ordering.
     */
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
    @DisplayName("demand is weighted by kind: an alert outweighs a view")
    void demandIsWeightedByKind() throws Exception {
        locality();
        send("{\"kind\":\"view\",\"localitySlug\":\"" + LOCALITY + "\"}");
        send("{\"kind\":\"search\",\"localitySlug\":\"" + LOCALITY + "\"}");
        send("{\"kind\":\"alert\",\"localitySlug\":\"" + LOCALITY + "\"}");

        // 1 view (x1) + 1 search (x2) + 1 alert (x5) = 8. Asserted as the total rather than as
        // three separate weights so that the test fails if the weights are changed without the
        // report's meaning being reconsidered -- which is the point of weighting on read.
        //
        // Hamcrest `contains` rather than a bare value: a filtered JSONPath yields an array even
        // when it selects one row, so `.value(8)` would be comparing a list to a number.
        mvc.perform(get("/admin/supply-gap").header("Authorization", bearer(admin())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.localitySlug=='" + LOCALITY + "')].searches")
                        .value(Matchers.contains(1)))
                .andExpect(jsonPath("$[?(@.localitySlug=='" + LOCALITY + "')].alerts")
                        .value(Matchers.contains(1)))
                .andExpect(jsonPath("$[?(@.localitySlug=='" + LOCALITY + "')].views")
                        .value(Matchers.contains(1)))
                .andExpect(jsonPath("$[?(@.localitySlug=='" + LOCALITY + "')].demand")
                        .value(Matchers.contains(8)));
    }

    @Test
    @DisplayName("a locality nobody has heard of is reported, not dropped")
    void theUnknownLocalityIsTheInterestingRow() throws Exception {
        send("{\"kind\":\"alert\",\"localitySlug\":\"" + UNKNOWN + "\"}");

        // No row in `localities`, no foreign key, and therefore no display name. This is a person
        // asking for somewhere Draazy does not cover, which is the single most useful row the
        // report can produce -- and exactly the row a foreign key would have rejected at write time.
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
        // Four anonymous searches for the same locality. The browser version stamped every one of
        // these with the literal user id 'anon' and reported them as one hot seeker; here they add
        // to `searches` and to nothing else, because nothing distinguishes four strangers from one.
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
