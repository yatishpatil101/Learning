package com.punenest.api.engagement;

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
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * D241 slice 4 — what the community says a society is.
 *
 * <p>Three features that were pure theatre. A resident who spent ten minutes filling in their
 * society's builder, year, tower count and amenities sent that work to their own browser and
 * nowhere else. The ops queue meant to review it read the reviewer's browser, so it was
 * permanently empty. Same for the WhatsApp invite — the one thing on the page that connects a new
 * neighbour to the people already there — and same for a corrected map pin, so every society
 * imported with a bad coordinate stayed wrong for everybody however many residents fixed it.
 *
 * <p>What is asserted here is what a browser-local version could not be:
 *
 * <ol>
 *   <li><strong>An approved proposal changes the society for everybody.</strong> The catalogue row
 *       itself moves; there is no second, disagreeing copy.</li>
 *   <li><strong>A detail suggestion needs no verified flat, but the invite and the pin do.</strong>
 *       Enriching a thin society is how a community society becomes a verified one; asserting where
 *       the building is, or handing out a key to its private group, is not.</li>
 *   <li><strong>The invite URL is withheld from anyone without a verified flat</strong>, approved
 *       or not. A stranger learns a group exists and nothing that would let them into it.</li>
 *   <li><strong>A decided proposal cannot be re-decided.</strong> The second decision would either
 *       double-apply a suggestion or silently revert the one the author was already told about.</li>
 *   <li><strong>A pin outside the city is refused</strong>, because that correction is invisible
 *       until somebody drives there.</li>
 *   <li><strong>A partial suggestion does not blank what it does not mention.</strong> A resident
 *       correcting the builder must not wipe the tower count somebody else contributed.</li>
 * </ol>
 */
@DisplayName("Societies — community proposals")
class SocietyProposalTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /**
     * Mobile block 98650000xx — used by no other test class.
     *
     * <p>Nothing here provisions an account through a {@code REQUIRES_NEW} path, so the class-level
     * rollback takes these rows back out and no {@code @AfterAll} cleanup is needed.
     */
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
     * A seeded society by position, not by name — seed display names are not unique.
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

    private ResultActions propose(User u, String slug, String json) throws Exception {
        return mvc.perform(post("/societies/" + slug + "/proposals")
                .header(HttpHeaders.AUTHORIZATION, bearer(u))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json));
    }

    private String idOf(ResultActions r) throws Exception {
        String json = r.andReturn().getResponse().getContentAsString();
        int at = json.indexOf("\"id\":\"") + 6;
        return json.substring(at, json.indexOf('"', at));
    }

    private ResultActions decide(String auth, String id, String status) throws Exception {
        return mvc.perform(patch("/admin/society-proposals/" + id)
                .header(HttpHeaders.AUTHORIZATION, auth)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"" + status + "\"}"));
    }

    /**
     * Make this user a verified resident, which is what the invite and the pin require.
     *
     * <p>Written straight to the table rather than driven through apply-and-approve: this file is
     * about proposals, and routing every setup through the residency workflow would make a change
     * there fail here for reasons that have nothing to do with what is under test.
     */
    private void makeResident(User u, String slug) {
        jdbc.update("""
                insert into society_residents
                    (id, society_id, user_id, wing, flat, unit_key, relation, status, assigned_to)
                select gen_random_uuid(), s.id, ?, 'A', '101', 'A101', 'owner', 'verified', 'ops'
                from societies s where s.slug = ?""", u.getId(), slug);
    }

    private Map<String, Object> societyRow(String slug) {
        return jdbc.queryForMap(
                "select builder, year, towers, units, lat, lng, place_id, loc_source"
                        + " from societies where slug = ?", slug);
    }

    /* ------------------------------------------------------------ the details */

    @Test
    @DisplayName("an approved detail suggestion is written onto the society for everybody")
    void approvedDetailsReachTheCatalogue() throws Exception {
        String slug = society(0);
        User asha = user("9865000001", "Asha");

        String id = idOf(propose(asha, slug,
                "{\"kind\":\"details\",\"builder\":\"Kalpataru\",\"towers\":6,\"units\":420}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("pending")));

        decide(staff("9865000090"), id, "approved").andExpect(status().isOk());

        Map<String, Object> row = societyRow(slug);
        assertThat(row.get("builder")).isEqualTo("Kalpataru");
        assertThat(((Number) row.get("towers")).intValue()).isEqualTo(6);
        assertThat(((Number) row.get("units")).intValue()).isEqualTo(420);
    }

    @Test
    @DisplayName("a suggestion leaves alone the fields it does not mention")
    void partialSuggestionDoesNotBlank() throws Exception {
        String slug = society(1);
        jdbc.update("update societies set towers = 9, units = 300 where slug = ?", slug);

        String id = idOf(propose(user("9865000002", "Bhavna"), slug,
                "{\"kind\":\"details\",\"builder\":\"Gera\"}")
                .andExpect(status().isCreated()));
        decide(staff("9865000091"), id, "approved").andExpect(status().isOk());

        Map<String, Object> row = societyRow(slug);
        assertThat(row.get("builder")).isEqualTo("Gera");
        // The point of the coalesce: one resident correcting one fact must not erase the four
        // somebody else corrected last month.
        assertThat(((Number) row.get("towers")).intValue()).isEqualTo(9);
        assertThat(((Number) row.get("units")).intValue()).isEqualTo(300);
    }

    @Test
    @DisplayName("a suggestion carrying nothing is refused")
    void emptySuggestionIsRefused() throws Exception {
        propose(user("9865000003", "Chetan"), society(2), "{\"kind\":\"details\"}")
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("suggesting details needs no verified flat")
    void detailsAreNotResidentGated() throws Exception {
        // The store's own reason, kept: the point is to enrich a thin, bulk-imported society
        // without first demanding somebody verify a flat, which is how a community society
        // becomes a verified one.
        propose(user("9865000004", "Devika"), society(3),
                "{\"kind\":\"details\",\"builder\":\"Rohan\"}")
                .andExpect(status().isCreated());
    }

    /* ----------------------------------------------------------- the group link */

    @Test
    @DisplayName("only a verified resident can offer the WhatsApp group link")
    void inviteIsResidentGated() throws Exception {
        String slug = society(4);
        String url = "{\"kind\":\"whatsapp\",\"inviteUrl\":\"https://chat.whatsapp.com/AbCdEf123456\"}";

        propose(user("9865000005", "Eshan"), slug, url).andExpect(status().isForbidden());

        User resident = user("9865000006", "Farhan");
        makeResident(resident, slug);
        propose(resident, slug, url).andExpect(status().isCreated());
    }

    @Test
    @DisplayName("a link that only looks like a WhatsApp invite is refused")
    void inviteUrlMustBeReal() throws Exception {
        String slug = society(5);
        User resident = user("9865000007", "Gauri");
        makeResident(resident, slug);

        // Unanchored patterns accept this, and it is exactly the link a reviewer glancing at a
        // list would wave through.
        propose(resident, slug,
                "{\"kind\":\"whatsapp\",\"inviteUrl\":"
                        + "\"https://evil.example/?x=https://chat.whatsapp.com/AbCdEf123456\"}")
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("an approved invite reaches residents and no one else")
    void inviteIsWithheldFromOutsiders() throws Exception {
        String slug = society(6);
        User resident = user("9865000008", "Hema");
        makeResident(resident, slug);

        String id = idOf(propose(resident, slug,
                "{\"kind\":\"whatsapp\",\"inviteUrl\":\"https://chat.whatsapp.com/ZzYyXx987654\"}")
                .andExpect(status().isCreated()));
        decide(staff("9865000092"), id, "approved").andExpect(status().isOk());

        // A stranger is told the group is there — that is the nudge to verify a flat — and is
        // told nothing that would let them walk into it.
        mvc.perform(get("/societies/" + slug + "/proposals"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.whatsappAvailable").value(true))
                .andExpect(jsonPath("$.whatsappJoinUrl").doesNotExist());

        mvc.perform(get("/societies/" + slug + "/proposals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(resident)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.whatsappJoinUrl")
                        .value("https://chat.whatsapp.com/ZzYyXx987654"));
    }

    /* -------------------------------------------------------------- the map pin */

    @Test
    @DisplayName("an approved pin moves the society and records that a neighbour put it there")
    void approvedPinMovesTheSociety() throws Exception {
        String slug = society(7);
        User resident = user("9865000009", "Ishaan");
        makeResident(resident, slug);

        String id = idOf(propose(resident, slug,
                "{\"kind\":\"location\",\"lat\":18.5204,\"lng\":73.8567,"
                        + "\"placeId\":\"ChIJARFGZy2_wjsRQ-Oenb9DjYI\"}")
                .andExpect(status().isCreated()));
        decide(staff("9865000093"), id, "approved").andExpect(status().isOk());

        Map<String, Object> row = societyRow(slug);
        assertThat(((Number) row.get("lat")).doubleValue()).isEqualTo(18.5204);
        assertThat(row.get("place_id")).isEqualTo("ChIJARFGZy2_wjsRQ-Oenb9DjYI");
        // Provenance is stamped in the same statement as the coordinates. A pin whose source is
        // a separate write can be observed without one, and the hub would then caption a
        // neighbour's correction as an imported RERA coordinate.
        assertThat(row.get("loc_source")).isEqualTo("community");
    }

    @Test
    @DisplayName("a pin outside the city is refused")
    void pinMustBeInTheCity() throws Exception {
        String slug = society(8);
        User resident = user("9865000010", "Jaya");
        makeResident(resident, slug);

        // Bengaluru. Plausible, well-formed, and 840km wrong — the kind of correction nobody
        // catches until a buyer has driven there.
        propose(resident, slug, "{\"kind\":\"location\",\"lat\":12.97,\"lng\":77.59}")
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("half a point is not a point")
    void pinNeedsBothCoordinates() throws Exception {
        String slug = society(9);
        User resident = user("9865000011", "Kabir");
        makeResident(resident, slug);

        propose(resident, slug, "{\"kind\":\"location\",\"lat\":18.52}")
                .andExpect(status().isBadRequest());
    }

    /* ------------------------------------------------------------- the lifecycle */

    @Test
    @DisplayName("re-proposing corrects your own submission rather than queueing a second")
    void reproposingReplacesYourOwn() throws Exception {
        String slug = society(10);
        User asha = user("9865000012", "Leela");

        String first = idOf(propose(asha, slug,
                "{\"kind\":\"details\",\"builder\":\"Typoed Name\"}").andExpect(status().isCreated()));
        String second = idOf(propose(asha, slug,
                "{\"kind\":\"details\",\"builder\":\"Corrected Name\"}")
                .andExpect(status().isCreated()));

        assertThat(second).isEqualTo(first);
        Integer pending = jdbc.queryForObject("""
                select count(*) from society_proposals p
                join societies s on s.id = p.society_id
                where s.slug = ? and p.status = 'pending'""", Integer.class, slug);
        assertThat(pending).isEqualTo(1);
    }

    @Test
    @DisplayName("a second person cannot overwrite a proposal already awaiting review")
    void othersCannotOverwriteAPendingProposal() throws Exception {
        String slug = society(11);
        propose(user("9865000013", "Manav"), slug, "{\"kind\":\"details\",\"builder\":\"First\"}")
                .andExpect(status().isCreated());
        propose(user("9865000014", "Nisha"), slug, "{\"kind\":\"details\",\"builder\":\"Second\"}")
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("a decided proposal cannot be decided again")
    void decisionsAreFinal() throws Exception {
        String slug = society(12);
        String auth = staff("9865000094");
        String id = idOf(propose(user("9865000015", "Omkar"), slug,
                "{\"kind\":\"details\",\"builder\":\"Panchshil\"}").andExpect(status().isCreated()));

        decide(auth, id, "rejected").andExpect(status().isOk());
        // Without this the queue is a place an operator's decision quietly reverses months later.
        decide(auth, id, "approved").andExpect(status().isConflict());
    }

    @Test
    @DisplayName("a rejected suggestion never reaches the society")
    void rejectionChangesNothing() throws Exception {
        String slug = society(13);
        String before = (String) societyRow(slug).get("builder");

        String id = idOf(propose(user("9865000016", "Pooja"), slug,
                "{\"kind\":\"details\",\"builder\":\"Not This One\"}")
                .andExpect(status().isCreated()));
        decide(staff("9865000095"), id, "rejected").andExpect(status().isOk());

        assertThat(societyRow(slug).get("builder")).isEqualTo(before);
    }

    @Test
    @DisplayName("the ops queue reaches across societies and shows the invite it has to screen")
    void queueShowsWhatItMustReview() throws Exception {
        String slug = society(14);
        User resident = user("9865000017", "Rhea");
        makeResident(resident, slug);
        propose(resident, slug,
                "{\"kind\":\"whatsapp\",\"inviteUrl\":\"https://chat.whatsapp.com/QqWwEe112233\"}")
                .andExpect(status().isCreated());

        // Visible here and nowhere else: screening the link for a scam is the whole point of
        // the review, and an operator cannot screen what the response redacts.
        mvc.perform(get("/admin/society-proposals?status=pending&kind=whatsapp")
                        .header(HttpHeaders.AUTHORIZATION, staff("9865000096")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.societySlug == '" + slug + "')].inviteUrl")
                        .value("https://chat.whatsapp.com/QqWwEe112233"));
    }

    @Test
    @DisplayName("the author's own pending proposal comes back to them on the hub read")
    void authorSeesTheirOwnPending() throws Exception {
        String slug = society(15);
        User author = user("9865000018", "Sanjay");
        propose(author, slug, "{\"kind\":\"details\",\"builder\":\"Awaiting Review\"}")
                .andExpect(status().isCreated());

        mvc.perform(get("/societies/" + slug + "/proposals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pending[0].kind").value("details"))
                .andExpect(jsonPath("$.pending[0].builder").value("Awaiting Review"))
                .andExpect(jsonPath("$.pending[0].authorName").value("Sanjay"));
    }

    @Test
    @DisplayName("a proposal is never published with the proposer's mobile")
    void proposalsCarryNoMobile() throws Exception {
        String slug = society(16);
        propose(user("9865000019", "Tara"), slug, "{\"kind\":\"details\",\"builder\":\"Vilas\"}")
                .andExpect(status().isCreated());

        String json = mvc.perform(get("/societies/" + slug + "/proposals"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(json).doesNotContain("9865000019");
    }

    @Test
    @DisplayName("proposing needs an account")
    void anonymousCannotPropose() throws Exception {
        mvc.perform(post("/societies/" + society(17) + "/proposals")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"details\",\"builder\":\"Anon\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("an ordinary account cannot work the ops queue")
    void queueIsStaffOnly() throws Exception {
        mvc.perform(get("/admin/society-proposals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9865000020", "Uma"))))
                .andExpect(status().isForbidden());
    }
}
