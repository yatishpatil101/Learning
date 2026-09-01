package com.punenest.api.catalog.society;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Correcting a society's own facts, on the server.
 *
 * <p>{@code saveEdit} in {@code frontend/src/pages/admin/AdminSocieties.jsx} wrote the four facts —
 * registration, conveyance, the maintenance rate, the claim state — plus an internal note into
 * {@code pnSocietyOverlay} in the operator's own {@code localStorage}. So a correction was one
 * person's opinion held on one machine: the form said it saved, and the building's record was
 * unchanged for the next operator, for the directory, and for every searcher.
 *
 * <p>What is asserted here is what a browser-local edit could not be:
 *
 * <ol>
 *   <li><strong>A correction is a shared fact.</strong> Each of the four persists, and the operator
 *       who did not make it reads it back.</li>
 *   <li><strong>The note stays inside.</strong> It is ops prose about a named building — who
 *       confirmed what, what is still unverified — and it must not appear on the anonymous read of
 *       the same society. That is why the response is its own type rather than the public one with
 *       a field added.</li>
 *   <li><strong>Omitting a field leaves it alone.</strong> The four are corrected one at a time
 *       from different evidence, so a form that restated all of them would let stale values in a
 *       reopened tab revert the three the operator did not touch.</li>
 *   <li><strong>The note can be cleared.</strong> Which is why it is the one field where omission
 *       and an explicit blank mean different things — leave-alone semantics applied to every field
 *       uniformly would make a note impossible to remove.</li>
 *   <li><strong>A member cannot do it.</strong> The browser version had no server-side check at
 *       all, because there was no server call.</li>
 *   <li><strong>An unknown slug is a 404.</strong> The route is addressed by the slug, which is
 *       the public alias a link carries and therefore the handle most likely to be stale.</li>
 *   <li><strong>A maintenance rate in the wrong units is refused.</strong> The field is rupees per
 *       square foot and the adjacent mental model is the monthly bill, so this is the mistake that
 *       will actually be made.</li>
 * </ol>
 */
@DisplayName("Societies — correcting a building's facts")
class SocietyAdminEditTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /**
     * {@code AuditService.record} runs {@code REQUIRES_NEW}, so its rows commit and outlive this
     * class's rollback — everything else here goes back on its own. Every society this class mints
     * is named to end in {@code D244}, so its slug does, and this sweeps its own rows and nobody
     * else's.
     *
     * <p>Static, and therefore outside the per-test transaction, which is the only place this can
     * work: an {@code @AfterEach} version is rolled back along with the test that ran it, so the
     * rows survive anyway. Run before as well as after because sweeping only on the way out assumes
     * every previous run reached the exit, and the runs that did not — a killed build, an abandoned
     * debugger — are exactly the ones that left rows behind. The test database here is shared and
     * persistent, so "the table starts empty" is never true.
     */
    @BeforeAll
    static void removeAuditRowsLeftByAnEarlierRun(@Autowired JdbcTemplate jdbc) {
        sweepOwnAuditRows(jdbc);
    }

    /** @see #removeAuditRowsLeftByAnEarlierRun */
    @AfterAll
    static void removeAuditRowsThatEscapedRollback(@Autowired JdbcTemplate jdbc) {
        sweepOwnAuditRows(jdbc);
    }

    private static void sweepOwnAuditRows(JdbcTemplate jdbc) {
        jdbc.update("delete from audit_log where entity = 'society' and entity_id like '%-d244'");
    }

    /** Mobile block 98690000xx — used by no other test class. */
    private User member(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String staff(String mobile) {
        User u = new User(mobile, Roles.Wire.STAFF);
        u.setName("Ops " + mobile.substring(6));
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    /**
     * A community society, minted through the public route so it is built exactly as a member's
     * would be — which keeps this class clear of the seeded catalogue that sibling tests index into
     * positionally.
     */
    private String society(User author, String name) throws Exception {
        ResultActions minted = mvc.perform(post("/societies")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name + "\"}"))
                .andExpect(status().isCreated());
        String json = minted.andReturn().getResponse().getContentAsString();
        int at = json.indexOf("\"slug\":\"") + 8;
        return json.substring(at, json.indexOf('"', at));
    }

    private ResultActions edit(String token, String slug, String body) throws Exception {
        return mvc.perform(patch("/admin/societies/" + slug)
                .header(HttpHeaders.AUTHORIZATION, token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private ResultActions read(String token, String slug) throws Exception {
        return mvc.perform(get("/admin/societies/" + slug)
                .header(HttpHeaders.AUTHORIZATION, token));
    }

    private Map<String, Object> row(String slug) {
        return jdbc.queryForMap("select registration, conveyance, maintenance_per_sqft,"
                + " claim_status, admin_note from societies where slug = ?", slug);
    }

    // ------------------------------------------------------------- the shared fact

    @Test
    @DisplayName("each of the five fields persists, and a second operator reads them back")
    void anEditIsSharedRatherThanHeldInOneBrowser() throws Exception {
        User author = member("9869000001", "Aarav Edit");
        String first = staff("9869000002");
        String second = staff("9869000003");
        String slug = society(author, "Sereno Heights D244");

        edit(first, slug, "{\"registration\":true,\"conveyance\":true,"
                + "\"maintenancePerSqft\":3.5,\"claimStatus\":\"pending\","
                + "\"adminNote\":\"Conveyance deed seen; registration number unconfirmed.\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value(slug))
                .andExpect(jsonPath("$.registration").value(true))
                .andExpect(jsonPath("$.conveyance").value(true))
                .andExpect(jsonPath("$.maintenancePerSqft").value(3.5))
                .andExpect(jsonPath("$.claimStatus").value("pending"))
                .andExpect(jsonPath("$.adminNote")
                        .value("Conveyance deed seen; registration number unconfirmed."));

        // The second operator is the whole point: under the overlay this edit existed only in the
        // first one's browser, so this read returned the untouched row.
        read(second, slug)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.registration").value(true))
                .andExpect(jsonPath("$.maintenancePerSqft").value(3.5))
                .andExpect(jsonPath("$.claimStatus").value("pending"))
                .andExpect(jsonPath("$.adminNote")
                        .value("Conveyance deed seen; registration number unconfirmed."));

        Map<String, Object> stored = row(slug);
        assertThat(stored.get("registration")).isEqualTo(true);
        assertThat(stored.get("conveyance")).isEqualTo(true);
        assertThat(stored.get("claim_status")).isEqualTo("pending");
        assertThat(stored.get("admin_note").toString()).startsWith("Conveyance deed seen");
    }

    @Test
    @DisplayName("the internal note never appears on the public read of the same society")
    void theNoteDoesNotLeaveTheBackOffice() throws Exception {
        User author = member("9869000004", "Isha Note");
        String slug = society(author, "Palm Grove D244");

        edit(staff("9869000005"), slug, "{\"adminNote\":\"Committee unreachable since June.\"}")
                .andExpect(status().isOk());

        // Anonymous, because that is the reader this is protecting from — but the field is absent
        // from the public shape for every caller, since it is a different type and not a filtered
        // one.
        mvc.perform(get("/societies/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value(slug))
                .andExpect(jsonPath("$.adminNote").doesNotExist());
    }

    @Test
    @DisplayName("an omitted field is left alone; a blank note clears it")
    void omissionMeansUnchangedAndTheNoteIsTheExceptionThatProvesIt() throws Exception {
        User author = member("9869000006", "Rohan Patch");
        String ops = staff("9869000007");
        String slug = society(author, "Vasant Vihar D244");

        edit(ops, slug, "{\"registration\":true,\"maintenancePerSqft\":2.75,"
                + "\"adminNote\":\"Registration certificate on file.\"}")
                .andExpect(status().isOk());

        // Only the claim state is sent. A PUT-shaped write from a reopened tab would have reverted
        // the other three to whatever that tab was still showing.
        edit(ops, slug, "{\"claimStatus\":\"claimed\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.registration").value(true))
                .andExpect(jsonPath("$.maintenancePerSqft").value(2.75))
                .andExpect(jsonPath("$.claimStatus").value("claimed"))
                .andExpect(jsonPath("$.adminNote").value("Registration certificate on file."));

        // An emptied textarea sends a blank string, and it has to mean "remove this" — which is the
        // one thing omission cannot express, and the reason the note is not written by the same
        // leave-alone rule as the four facts.
        edit(ops, slug, "{\"adminNote\":\"   \"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.adminNote").doesNotExist());
        assertThat(row(slug).get("admin_note")).isNull();
    }

    // ------------------------------------------------------------- who may, and what is refused

    @Test
    @DisplayName("a member cannot read the back-office view, note and all")
    void aMemberCannotReadTheNote() throws Exception {
        User author = member("9869000014", "Rohan Reader");
        String slug = society(author, "Cedar Court D244");

        edit(staff("9869000015"), slug, "{\"adminNote\":\"Secretary disputes the plot area.\"}")
                .andExpect(status().isOk());

        // Again the society's own author, who has the strongest claim of anyone outside the desk
        // and still none: this payload carries ops prose about their neighbours.
        mvc.perform(get("/admin/societies/" + slug)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(status().isForbidden());

        mvc.perform(get("/admin/societies/" + slug))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("reading an unknown slug is a 404, not an empty society")
    void readingAnUnknownSlugIsNotFound() throws Exception {
        // A blank form for a society that does not exist is the worse failure: the operator fills
        // it in and saves, and only the write tells them the slug was stale.
        read(staff("9869000016"), "no-such-society-d244")
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a member cannot correct a society's facts")
    void aMemberIsRefused() throws Exception {
        User author = member("9869000008", "Sneha Member");
        String slug = society(author, "Green Acres D244");

        // The author of the society, which is the strongest version of the case: if anyone outside
        // the back office had a claim to edit these facts it would be them, and they still do not.
        mvc.perform(patch("/admin/societies/" + slug)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"registration\":true}"))
                .andExpect(status().isForbidden());

        assertThat(row(slug).get("registration")).isEqualTo(false);
    }

    @Test
    @DisplayName("an unknown slug is a 404")
    void anUnknownSlugIsNotFound() throws Exception {
        edit(staff("9869000009"), "no-such-society-d244", "{\"registration\":true}")
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a maintenance rate that is really a monthly bill is refused")
    void maintenanceIsValidatedAsRupeesPerSquareFoot() throws Exception {
        User author = member("9869000010", "Kabir Rate");
        String ops = staff("9869000011");
        String slug = society(author, "Orchid Enclave D244");

        // 4500 is a plausible monthly maintenance bill and an implausible per-sq-ft rate — it would
        // quote a 1000 sq ft flat forty-five lakh a month. The units mistake is the one that will
        // actually be made, so it is the one the server has to catch.
        edit(ops, slug, "{\"maintenancePerSqft\":4500}")
                .andExpect(status().isUnprocessableEntity());

        edit(ops, slug, "{\"maintenancePerSqft\":-1}")
                .andExpect(status().isUnprocessableEntity());

        // Refused, not clamped, and nothing was written on the way to refusing it.
        assertThat(row(slug).get("maintenance_per_sqft")).isNull();
    }

    @Test
    @DisplayName("a claim state outside the three the column allows is refused")
    void claimStatusIsValidated() throws Exception {
        User author = member("9869000012", "Meera Claim");
        String slug = society(author, "Lake View D244");

        // The column's own check constraint would reject this too, but as a 500 — the difference
        // between a validation failure and a server error is the difference between an operator
        // being told what to type and an operator filing a bug.
        edit(staff("9869000013"), slug, "{\"claimStatus\":\"verified\"}")
                .andExpect(status().isUnprocessableEntity());

        assertThat(row(slug).get("claim_status")).isEqualTo("unclaimed");
    }
}
