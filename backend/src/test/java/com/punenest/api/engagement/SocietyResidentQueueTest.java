package com.punenest.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * {@code GET /admin/society-residents} — who is waiting to be recognised, anywhere.
 *
 * <p>The residency data has been real since the claims slice, but the only route to it was addressed
 * by slug, so the console tab that is cross-society by definition kept reading the operator's own
 * browser and was permanently empty however many people applied.
 *
 * <p>What is asserted here is the part the per-society route could not do:
 *
 * <ol>
 *   <li><strong>One call reaches every society</strong>, and each row names the building it is
 *       about — a cross-society row that says only "B/704, pending" is not a decision anybody can
 *       make.</li>
 *   <li><strong>Oldest first</strong>, the opposite of every consumer feed here: the person who has
 *       waited longest is the one still waiting.</li>
 *   <li><strong>The status filter narrows the database's work, not the browser's.</strong> A
 *       mistyped status is refused rather than answered with an empty page, because an operator
 *       shown nothing reads it as "no backlog".</li>
 *   <li><strong>Only ops may read it.</strong> The queue publishes names and mobiles across the
 *       whole catalogue; per-society, a committee may read its own, and here there is no society to
 *       be the committee of.</li>
 *   <li><strong>The row is enough to act on.</strong> Deciding goes through the per-society route
 *       that already exists, addressed by the slug this queue publishes — there is deliberately no
 *       second decision route to keep in step with it.</li>
 * </ol>
 */
@DisplayName("Societies — the cross-society residency queue")
class SocietyResidentQueueTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /** Mobile block 98675000xx, used by no other test class. */
    private User user(String mobile, String name) {
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
     * A seeded society by position, not by name — a curation pass must not turn a rule red.
     *
     * <p>{@code source <> 'community'} keeps the position stable against every mint the suite
     * performs; see {@code SocietyContributionTest#society} for what an unfiltered offset costs.
     */
    private String society(int offset) {
        List<String> slugs = jdbc.queryForList(
                "select slug from societies where source <> 'community' order by slug offset ? limit 1",
                String.class, offset);
        assertThat(slugs).as("a seeded society at offset " + offset).hasSize(1);
        return slugs.get(0);
    }

    private String nameOf(String slug) {
        return jdbc.queryForObject("select name from societies where slug = ?", String.class, slug);
    }

    private ResultActions apply(User u, String slug, String wing, String flat) throws Exception {
        return mvc.perform(post("/societies/" + slug + "/residents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"wing\":\"" + wing + "\",\"flat\":\"" + flat
                                + "\",\"relation\":\"owner\"}"))
                .andExpect(status().isOk());
    }

    private String idOf(ResultActions r) throws Exception {
        return JsonPath.read(r.andReturn().getResponse().getContentAsString(), "$.id");
    }

    private String queue(String auth, String query) throws Exception {
        return mvc.perform(get("/admin/society-residents" + query)
                        .header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /** A JSONPath filter always yields an array; this is the single matching value in it. */
    private static String only(String json, String path) {
        List<String> found = JsonPath.read(json, path);
        assertThat(found).as(path).hasSize(1);
        return found.get(0);
    }

    /* ------------------------------------------------------- across societies */

    @Test
    @DisplayName("one call reaches every society, and each row names the one it is about")
    void queueSpansSocieties() throws Exception {
        String first = society(20);
        String second = society(21);
        apply(user("9867500001", "Aditi"), first, "P", "101");
        apply(user("9867500002", "Bhaskar"), second, "Q", "202");

        String json = queue(staff("9867500090"), "?status=pending&size=100");

        // Both buildings answered by one request. The console's old shape was one request per
        // society to find the handful with anything pending.
        assertThat((List<String>) JsonPath.read(json, "$.content[*].societySlug"))
                .contains(first, second);
        assertThat(only(json, "$.content[?(@.societySlug == '" + first + "')].societyName"))
                .isEqualTo(nameOf(first));
        assertThat(only(json, "$.content[?(@.unitKey == 'Q202')].name")).isEqualTo("Bhaskar");
    }

    @Test
    @DisplayName("oldest first — the person who has waited longest is the one still waiting")
    void oldestFirst() throws Exception {
        apply(user("9867500003", "Chandni"), society(22), "R", "1");
        apply(user("9867500004", "Devendra"), society(23), "R", "2");

        List<String> units = JsonPath.read(queue(staff("9867500091"), "?status=pending&size=100"),
                "$.content[*].unitKey");
        assertThat(units).containsSubsequence("R1", "R2");
    }

    @Test
    @DisplayName("the reviewer sees who is asking — name, mobile and the conflict flag")
    void theQueuePublishesWhatADecisionNeeds() throws Exception {
        String slug = society(24);
        String ops = staff("9867500092");
        String held = idOf(apply(user("9867500005", "Esha"), slug, "S", "7"));
        mvc.perform(patch("/societies/" + slug + "/residents/" + held)
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"verified\"}"))
                .andExpect(status().isOk());

        // A second person on a flat somebody already holds is recorded and marked, not refused —
        // the server cannot tell a handover from an impostor, and the operator can.
        apply(user("9867500006", "Farida"), slug, "S", "7");

        String json = queue(ops, "?status=pending&size=100");
        assertThat(only(json, "$.content[?(@.name == 'Farida')].mobile"))
                .isEqualTo("9867500006");
        assertThat(only(json, "$.content[?(@.name == 'Farida')].flagged")).isEqualTo("conflict");
        assertThat(only(json, "$.content[?(@.name == 'Farida')].assignedTo")).isEqualTo("ops");
    }

    /* -------------------------------------------------------------- filtering */

    @Test
    @DisplayName("the status filter is applied by the database, not by the browser")
    void statusFilterNarrowsTheQueue() throws Exception {
        String slug = society(25);
        String id = idOf(apply(user("9867500007", "Gaurav"), slug, "T", "3"));
        String ops = staff("9867500093");

        assertThat((List<String>) JsonPath.read(queue(ops, "?status=pending&size=100"),
                "$.content[*].id")).contains(id);

        mvc.perform(patch("/societies/" + slug + "/residents/" + id)
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"verified\"}"))
                .andExpect(status().isOk());

        // Deciding it takes it out of the backlog and puts it in the record — which is the whole
        // reason the row this queue published was enough to act on without a second route.
        assertThat((List<String>) JsonPath.read(queue(ops, "?status=pending&size=100"),
                "$.content[*].id")).doesNotContain(id);
        assertThat((List<String>) JsonPath.read(queue(ops, "?status=verified&size=100"),
                "$.content[*].id")).contains(id);
    }

    @Test
    @DisplayName("an unknown status is refused rather than answered with an empty page")
    void unknownStatusIsRefused() throws Exception {
        mvc.perform(get("/admin/society-residents?status=approved")
                        .header(HttpHeaders.AUTHORIZATION, staff("9867500094")))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("no status at all means everything, decided rows included")
    void unfilteredQueueCarriesDecidedRows() throws Exception {
        String slug = society(26);
        String id = idOf(apply(user("9867500008", "Harini"), slug, "U", "4"));
        String ops = staff("9867500095");
        mvc.perform(patch("/societies/" + slug + "/residents/" + id)
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"rejected\"}"))
                .andExpect(status().isOk());

        assertThat((List<String>) JsonPath.read(queue(ops, "?size=100"), "$.content[*].id"))
                .contains(id);
    }

    /* ------------------------------------------------------------------ who */

    @Test
    @DisplayName("an ordinary account cannot work the ops queue")
    void queueIsStaffOnly() throws Exception {
        mvc.perform(get("/admin/society-residents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9867500009", "Irfan"))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a resident of one society may not read every other society's applicants")
    void residencyIsNotAPassToTheQueue() throws Exception {
        String slug = society(27);
        User resident = user("9867500010", "Jyoti");
        String id = idOf(apply(resident, slug, "V", "5"));
        mvc.perform(patch("/societies/" + slug + "/residents/" + id)
                        .header(HttpHeaders.AUTHORIZATION, staff("9867500096"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"verified\"}"))
                .andExpect(status().isOk());

        // Per-society, a committee may read its own queue. Here there is no society to be the
        // committee of, so the only caller the route can admit is platform staff.
        mvc.perform(get("/admin/society-residents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(resident)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("the queue needs an account")
    void anonymousIsRefused() throws Exception {
        mvc.perform(get("/admin/society-residents"))
                .andExpect(status().isUnauthorized());
    }

    /* --------------------------------------------------------------- paging */

    @Test
    @DisplayName("the page envelope is the platform's, and the page is cut by the database")
    void pagingIsServerSide() throws Exception {
        apply(user("9867500011", "Kunal"), society(28), "W", "1");
        apply(user("9867500012", "Lata"), society(29), "W", "2");

        mvc.perform(get("/admin/society-residents?status=pending&size=1")
                        .header(HttpHeaders.AUTHORIZATION, staff("9867500097")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.size").value(1))
                .andExpect(jsonPath("$.page").value(0));
    }
}
