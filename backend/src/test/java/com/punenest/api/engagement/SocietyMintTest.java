package com.punenest.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
 * D241 slice 5 — adding a society the catalogue does not have.
 *
 * <p>A lister who could not find their society, and a searcher who wanted alerting the moment a
 * flat came up in one, were both offered "Add it". That mint wrote to {@code pnCommunitySocieties}
 * in the one browser that did it. The society existed for exactly one person: nobody else could
 * find it, follow it, or list a flat in it — which is the entire reason somebody adds one.
 * Following it then 404'd against a server that had never heard of the slug. And the ops queue that
 * was supposed to promote it read the operator's own browser, so it was permanently empty: not one
 * member-added society has ever been confirmed.
 *
 * <p>What is asserted here is what a browser-local version could not be:
 *
 * <ol>
 *   <li><strong>A minted society is immediately findable by somebody else</strong> — it is in the
 *       directory, by slug and by search, in the same request that created it.</li>
 *   <li><strong>The duplicate guard holds on the name, not only on the slug.</strong> The slug folds
 *       the locality in, so the same society typed without one does not collide at all, and a
 *       slug-only check would wave a second copy of a verified RERA society straight through. That
 *       duplicate is unrecoverable without an operator merging it by hand.</li>
 *   <li><strong>Matching an existing society is a 200, not an error.</strong> The caller asked for a
 *       society by name and there is one; handing it back is the answer to their question.</li>
 *   <li><strong>The candidates queue contains member-added societies and nothing else.</strong> An
 *       operator asked to confirm 320 MahaRERA imports stops reading the queue.</li>
 *   <li><strong>Verifying is idempotent-hostile: the second operator gets a 409.</strong> Silently
 *       overwriting who verified a society destroys the only record of who to ask about it.</li>
 *   <li><strong>Verifying does not touch {@code registration} or {@code conveyance}.</strong> Those
 *       describe the building's legal state, not our confidence in the record.</li>
 * </ol>
 */
@DisplayName("Societies — community minting")
class SocietyMintTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /**
     * Mobile block 98660000xx — used by no other test class.
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

    private ResultActions mint(User u, String json) throws Exception {
        return mvc.perform(post("/societies")
                .header(HttpHeaders.AUTHORIZATION, bearer(u))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json));
    }

    private static String body(String name) {
        return "{\"name\":\"" + name + "\"}";
    }

    private String slugOf(ResultActions r) throws Exception {
        String json = r.andReturn().getResponse().getContentAsString();
        int at = json.indexOf("\"slug\":\"") + 8;
        return json.substring(at, json.indexOf('"', at));
    }

    private String idOf(ResultActions r) throws Exception {
        String json = r.andReturn().getResponse().getContentAsString();
        int at = json.indexOf("\"id\":\"") + 6;
        return json.substring(at, json.indexOf('"', at));
    }

    private Map<String, Object> row(String slug) {
        return jdbc.queryForMap(
                "select id, name, source, locality_slug, lat, lng, created_by, verified_at,"
                        + " verified_by, registration, conveyance, claim_status"
                        + " from societies where slug = ?", slug);
    }

    /** A seeded RERA society by position, not by name — seed display names are not unique. */
    private Map<String, Object> seeded(int offset) {
        return jdbc.queryForMap(
                "select slug, name from societies where source = 'rera' order by slug offset ?"
                        + " limit 1", offset);
    }

    // ---------------------------------------------------------------- minting

    @Test
    @DisplayName("a society somebody adds exists for everybody, not just for them")
    void mintReachesTheCatalogue() throws Exception {
        User author = user("9866000001", "Nikhil Mint");

        ResultActions created = mint(author, "{\"name\":\"Sunview Heights D241\","
                + "\"localityLabel\":\"Wakad\",\"lat\":18.598,\"lng\":73.762}");
        created.andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Sunview Heights D241"))
                .andExpect(jsonPath("$.source").value("community"))
                // Not verified: it is a candidate, and the card has to be able to say so.
                .andExpect(jsonPath("$.verifiedAt").doesNotExist())
                .andExpect(jsonPath("$.claimStatus").value("unclaimed"));

        String slug = slugOf(created);
        // The locality is folded into the slug so two societies of the same name in different
        // suburbs do not collide.
        assertThat(slug).isEqualTo("sunview-heights-d241-wakad");

        // Findable by a completely different, anonymous reader in the very next request. This is
        // the whole point: the browser-local version was visible to exactly one person.
        mvc.perform(get("/societies/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Sunview Heights D241"));

        Map<String, Object> stored = row(slug);
        assertThat(stored.get("created_by")).isEqualTo(author.getId());
        assertThat(stored.get("source")).isEqualTo("community");
        assertThat(stored.get("verified_at")).isNull();
        // The pin the caller supplied is kept — it is usually better than the locality centroid.
        assertThat(((Number) stored.get("lat")).doubleValue()).isEqualTo(18.598);
    }

    @Test
    @DisplayName("a society you add is searchable by name straight away")
    void mintIsSearchable() throws Exception {
        User author = user("9866000002", "Gauri Mint");
        String slug = slugOf(mint(author, body("Peregrine Court D241"))
                .andExpect(status().isCreated()));

        mvc.perform(get("/societies").param("q", "Peregrine Court D241"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].slug").value(slug));
    }

    @Test
    @DisplayName("an unrecognised locality is dropped, not stored as a broken reference")
    void unknownLocalityIsDropped() throws Exception {
        User author = user("9866000003", "Tanvi Mint");

        // `societies.locality_slug` is a foreign key. An area the caller invented is not a field we
        // can store; it is a constraint violation, and a 500 on a form filled in correctly.
        String slug = slugOf(mint(author, "{\"name\":\"Marigold Enclave D241\","
                + "\"localitySlug\":\"not-a-real-locality-d241\"}")
                .andExpect(status().isCreated()));

        assertThat(row(slug).get("locality_slug")).isNull();
    }

    @Test
    @DisplayName("adding a society that already exists hands back the one that does")
    void duplicateSlugReturnsTheCanonicalRow() throws Exception {
        User first = user("9866000004", "Sakshi Mint");
        User second = user("9866000005", "Rohit Mint");

        ResultActions original = mint(first, body("Trellis Grove D241")).andExpect(status().isCreated());
        String slug = slugOf(original);
        String id = idOf(original);

        // 200, not 201, and not an error: they asked for a society by name and there is one.
        ResultActions again = mint(second, body("Trellis Grove D241")).andExpect(status().isOk());
        assertThat(idOf(again)).isEqualTo(id);
        assertThat(slugOf(again)).isEqualTo(slug);

        Integer copies = jdbc.queryForObject(
                "select count(*) from societies where lower(name) = lower(?)",
                Integer.class, "Trellis Grove D241");
        assertThat(copies).isOne();
    }

    @Test
    @DisplayName("case and stray spacing do not mint a second copy")
    void caseAndSpacingDoNotDuplicate() throws Exception {
        User author = user("9866000006", "Isha Mint");
        String id = idOf(mint(author, body("Larkspur Residency D241")).andExpect(status().isCreated()));

        assertThat(idOf(mint(author, body("  larkspur RESIDENCY d241  ")).andExpect(status().isOk())))
                .isEqualTo(id);
    }

    @Test
    @DisplayName("the same society typed without its locality does not become a second society")
    void nameGuardCatchesWhatTheSlugGuardCannot() throws Exception {
        User author = user("9866000007", "Omkar Mint");

        // The one that matters. "Kumar Pinnacle" typed without a locality slugifies to
        // `kumar-pinnacle`, which does not collide with the RERA row's `kumar-pinnacle-wakad` at
        // all — so a slug-only guard would mint a permanent duplicate of a society we already hold
        // verified, and nothing automatic could undo it: listings, follows, reviews and residency
        // claims accumulate against both slugs until an operator finds them.
        Map<String, Object> existing = seeded(0);
        String name = (String) existing.get("name");

        ResultActions r = mint(author, body(name)).andExpect(status().isOk());
        assertThat(slugOf(r)).isEqualTo(existing.get("slug"));

        Integer copies = jdbc.queryForObject(
                "select count(*) from societies where lower(trim(name)) = lower(trim(?))",
                Integer.class, name);
        assertThat(copies).isOne();
    }

    @Test
    @DisplayName("adding a society needs an account")
    void mintNeedsAnAccount() throws Exception {
        mvc.perform(post("/societies")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("Anonymous Towers D241")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a name of one character is a keystroke, not a society")
    void tooShortIsRefused() throws Exception {
        User author = user("9866000008", "Rhea Mint");
        mint(author, body("K")).andExpect(status().is4xxClientError());
    }

    @Test
    @DisplayName("a blank name is refused rather than stored as an unnamed building")
    void blankNameIsRefused() throws Exception {
        User author = user("9866000009", "Vikram Mint");
        mint(author, body("   ")).andExpect(status().is4xxClientError());
    }

    @Test
    @DisplayName("a name that is nothing but punctuation is refused, not given an empty address")
    void unroutableNameIsRefused() throws Exception {
        User author = user("9866000010", "Kabir Mint");

        // It passes the length check and slugifies to the empty string. Minting it would produce a
        // society at `/society/` that nobody — including its author — could ever open.
        mint(author, body("!!! ???")).andExpect(status().isUnprocessableEntity());
    }

    // -------------------------------------------------------------- ops queue

    @Test
    @DisplayName("the candidates queue holds member-added societies and nothing else")
    void queueHoldsOnlyCandidates() throws Exception {
        User author = user("9866000011", "Aditi Mint");
        String ops = staff("9866000012");
        String slug = slugOf(mint(author, body("Halcyon Vista D241")).andExpect(status().isCreated()));

        String json = mvc.perform(get("/admin/society-candidates")
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .param("size", "100"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(json).contains(slug);
        // Curated and RERA rows are verified by construction. An operator asked to confirm 320
        // MahaRERA imports is an operator who stops reading the queue.
        assertThat(json).doesNotContain("\"source\":\"rera\"").doesNotContain("\"source\":\"curated\"");
    }

    @Test
    @DisplayName("the candidates queue is staff-only")
    void queueIsStaffOnly() throws Exception {
        User buyer = user("9866000013", "Neha Mint");
        mvc.perform(get("/admin/society-candidates")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());

        mvc.perform(get("/admin/society-candidates")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("verifying records who checked it and takes it out of the queue")
    void verifyStampsAndDequeues() throws Exception {
        User author = user("9866000014", "Priya Mint");
        String ops = staff("9866000015");
        String slug = slugOf(mint(author, body("Cascade Manor D241")).andExpect(status().isCreated()));

        mvc.perform(post("/admin/society-candidates/" + slug + "/verify")
                        .header(HttpHeaders.AUTHORIZATION, ops))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value(slug))
                .andExpect(jsonPath("$.verifiedAt").exists());

        Map<String, Object> stored = row(slug);
        assertThat(stored.get("verified_at")).isNotNull();
        assertThat(stored.get("verified_by")).isNotNull();

        String queue = mvc.perform(get("/admin/society-candidates")
                        .header(HttpHeaders.AUTHORIZATION, ops).param("size", "100"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(queue).doesNotContain(slug);
    }

    @Test
    @DisplayName("verifying says the society is real, not that its paperwork is done")
    void verifyDoesNotTouchTheLegalFlags() throws Exception {
        User author = user("9866000016", "Sneha Mint");
        String ops = staff("9866000017");
        String slug = slugOf(mint(author, body("Ridgeline Court D241")).andExpect(status().isCreated()));

        mvc.perform(post("/admin/society-candidates/" + slug + "/verify")
                        .header(HttpHeaders.AUTHORIZATION, ops))
                .andExpect(status().isOk());

        // `registration` and `conveyance` are claims about the building's legal state. Setting them
        // here is how a member-added row would start telling a buyer its conveyance deed is done
        // because somebody confirmed the society exists.
        Map<String, Object> stored = row(slug);
        assertThat(stored.get("registration")).isEqualTo(false);
        assertThat(stored.get("conveyance")).isEqualTo(false);
    }

    @Test
    @DisplayName("the second operator to verify the same society is told somebody already did")
    void verifyTwiceConflicts() throws Exception {
        User author = user("9866000018", "Meera Mint");
        String first = staff("9866000019");
        String second = staff("9866000020");
        String slug = slugOf(mint(author, body("Willow Bend D241")).andExpect(status().isCreated()));

        mvc.perform(post("/admin/society-candidates/" + slug + "/verify")
                        .header(HttpHeaders.AUTHORIZATION, first))
                .andExpect(status().isOk());

        // Not a silent no-op: overwriting who verified a society destroys the only record of who to
        // ask about it.
        mvc.perform(post("/admin/society-candidates/" + slug + "/verify")
                        .header(HttpHeaders.AUTHORIZATION, second))
                .andExpect(status().isConflict());

        List<Map<String, Object>> stamps = jdbc.queryForList(
                "select verified_by from societies where slug = ?", slug);
        assertThat(stamps).hasSize(1);
    }

    @Test
    @DisplayName("a RERA society is not a candidate and cannot be 'verified'")
    void reraSocietyIsNotACandidate() throws Exception {
        String ops = staff("9866000021");
        String slug = (String) seeded(1).get("slug");

        mvc.perform(post("/admin/society-candidates/" + slug + "/verify")
                        .header(HttpHeaders.AUTHORIZATION, ops))
                .andExpect(status().is4xxClientError());
    }

    @Test
    @DisplayName("verifying a society that does not exist is a 404, not a silent success")
    void verifyUnknownSlugIs404() throws Exception {
        String ops = staff("9866000022");
        mvc.perform(post("/admin/society-candidates/no-such-society-d241/verify")
                        .header(HttpHeaders.AUTHORIZATION, ops))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("verifying is staff-only")
    void verifyIsStaffOnly() throws Exception {
        User author = user("9866000023", "Kunal Mint");
        String slug = slugOf(mint(author, body("Selfserve Heights D241")).andExpect(status().isCreated()));

        // The person who added it does not get to confirm it. That would make the queue a formality
        // and the "verified" badge worth nothing.
        mvc.perform(post("/admin/society-candidates/" + slug + "/verify")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(status().isForbidden());
    }
}
