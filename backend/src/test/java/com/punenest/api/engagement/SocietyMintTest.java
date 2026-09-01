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
 *   <li><strong>Which end the mint came from survives the round trip.</strong> A society a searcher
 *       asked for is unserved demand; the same society added by somebody posting a flat is supply
 *       arriving. {@code mintOrigin} is the only thing on the row that can tell an operator which,
 *       and it is a different axis from {@code source} — which stays {@code community} either
 *       way — rather than a fourth value of it.</li>
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
                "select id, name, source, mint_origin, locality_slug, lat, lng, created_by,"
                        + " verified_at, verified_by, registration, conveyance, claim_status"
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

    // ----------------------------------------------------------- mint origin

    /**
     * A mint that states which surface the caller was standing on.
     *
     * @param origin the raw value, sent exactly as given so a bad one can be tested
     */
    private static String bodyFrom(String name, String origin) {
        return "{\"name\":\"" + name + "\",\"mintOrigin\":\"" + origin + "\"}";
    }

    @Test
    @DisplayName("a society a searcher asked for is stored as demand, not as supply")
    void demandOriginRoundTrips() throws Exception {
        User author = user("9866000024", "Farhan Mint");

        // The one the Society Finder sends, and the reason this column exists. A society minted
        // because somebody wanted a flat in it is unserved demand; the same row minted from the
        // listing wizard is supply arriving. Ops sources inventory off the difference, and until
        // this field there was nothing in the row that could tell them apart.
        ResultActions created = mint(author, bodyFrom("Aster Bloom D241", "demand"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.mintOrigin").value("demand"))
                // The other axis is untouched: how the record got here is still `community`.
                .andExpect(jsonPath("$.source").value("community"));

        assertThat(row(slugOf(created)).get("mint_origin")).isEqualTo("demand");
    }

    @Test
    @DisplayName("a society a lister added is stored as coming from a listing")
    void listingOriginRoundTrips() throws Exception {
        User author = user("9866000025", "Deepa Mint");

        ResultActions created = mint(author, bodyFrom("Basil Court D241", "listing"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.mintOrigin").value("listing"));

        assertThat(row(slugOf(created)).get("mint_origin")).isEqualTo("listing");
    }

    @Test
    @DisplayName("a client that has never heard of mint origin can still add a society")
    void omittedOriginDefaultsToListing() throws Exception {
        User author = user("9866000026", "Yash Mint");

        // Shipped clients predate the field. Refusing them would take a working mint away for the
        // sake of a column ops reads, so it defaults -- and it defaults to `listing` on purpose.
        // Every mint surface but the finder is on the listing side and the finder states its
        // origin, so the default can under-report demand and can never invent it. Invented demand
        // sends an operator to source inventory in a building nobody asked about, and they find
        // that out only after going.
        ResultActions created = mint(author, body("Cinnamon Rise D241"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.mintOrigin").value("listing"));

        assertThat(row(slugOf(created)).get("mint_origin")).isEqualTo("listing");
    }

    @Test
    @DisplayName("an origin nobody defined is refused rather than stored and silently ignored")
    void unknownOriginIsRefused() throws Exception {
        User author = user("9866000027", "Zoya Mint");

        // The dangerous case, and why this is not left to the database CHECK. A value the CHECK
        // happened to admit would never match `demand` downstream: the society would sit in the
        // queue looking like supply forever and nothing would have complained.
        mint(author, bodyFrom("Damson Park D241", "Demand")).andExpect(status().isUnprocessableEntity());
        mint(author, bodyFrom("Damson Park D241", "search")).andExpect(status().isUnprocessableEntity());

        Integer minted = jdbc.queryForObject(
                "select count(*) from societies where lower(name) = lower(?)",
                Integer.class, "Damson Park D241");
        assertThat(minted).isZero();
    }

    @Test
    @DisplayName("a bad origin is refused even when the society already exists")
    void unknownOriginIsRefusedOnTheDuplicatePath() throws Exception {
        User author = user("9866000028", "Ansh Mint");
        mint(author, bodyFrom("Elder Row D241", "listing")).andExpect(status().isCreated());

        // A check that only fires on the mint path is one a client passes by accident for weeks and
        // then fails in production the first time it adds a building nobody had.
        mint(author, bodyFrom("Elder Row D241", "nonsense")).andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("reaching a society somebody already listed in does not rewrite how it got here")
    void matchingAnExistingSocietyKeepsItsOrigin() throws Exception {
        User lister = user("9866000029", "Harsh Mint");
        User searcher = user("9866000030", "Ira Mint");

        String slug = slugOf(mint(lister, bodyFrom("Fennel Heights D241", "listing"))
                .andExpect(status().isCreated()));

        // Real demand, and deliberately not recorded here. Overwriting `listing` with `demand`
        // would tell an operator no flat has ever been posted in a building that is in the
        // catalogue precisely because one was. Wanting a society that already exists is what
        // following it is for.
        mint(searcher, bodyFrom("Fennel Heights D241", "demand"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mintOrigin").value("listing"));

        assertThat(row(slug).get("mint_origin")).isEqualTo("listing");
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
    @DisplayName("the candidates queue tells an operator which societies searchers are asking for")
    void queueCarriesTheMintOrigin() throws Exception {
        User searcher = user("9866000031", "Janaki Mint");
        User lister = user("9866000032", "Kartik Mint");
        String ops = staff("9866000033");

        String wanted = slugOf(mint(searcher, bodyFrom("Gorse Terrace D241", "demand"))
                .andExpect(status().isCreated()));
        String posted = slugOf(mint(lister, bodyFrom("Hazel Court D241", "listing"))
                .andExpect(status().isCreated()));

        // The queue is the only place this fact is ever read. An operator scanning it is deciding
        // where to go and source inventory, and "somebody wants a flat here and there are none"
        // is the entire signal they are looking for -- a queue that cannot distinguish it from
        // "somebody is selling one here" is a queue that cannot answer the question it exists for.
        String json = mvc.perform(get("/admin/society-candidates")
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .param("size", "100"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(originIn(json, wanted)).isEqualTo("demand");
        assertThat(originIn(json, posted)).isEqualTo("listing");
    }

    /** The {@code mintOrigin} of one queue row, found by its slug. */
    private static String originIn(String json, String slug) {
        int row = json.indexOf("\"slug\":\"" + slug + "\"");
        assertThat(row).as("slug " + slug + " is in the queue").isNotNegative();
        int at = json.indexOf("\"mintOrigin\":\"", row) + 14;
        return json.substring(at, json.indexOf('"', at));
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

    // ------------------------------------------------------ duplicate hints

    /**
     * D252 — the duplicate column an operator reads before verifying anything.
     *
     * <p>It was computed in the browser against a bundled file of 28 curated societies. Every
     * duplicate this queue actually produces is a member-added row — that is what a candidate
     * <em>is</em> — and not one of those was in the file. So a candidate that was a textbook second
     * copy of another candidate rendered "No obvious match", the operator read that as "no duplicate
     * exists", and the junk row got verified into a permanent one.
     */
    private ResultActions dupes(String slug, String ops) throws Exception {
        return dupes(slug, ops, "");
    }

    private ResultActions dupes(String slug, String ops, String query) throws Exception {
        return mvc.perform(get("/admin/society-candidates/" + slug + "/duplicates" + query)
                .header(HttpHeaders.AUTHORIZATION, ops));
    }

    @Test
    @DisplayName("a candidate is matched against societies the browser never had")
    void duplicatesSeeOtherCandidates() throws Exception {
        User first = user("9866000041", "Meera Mint");
        User second = user("9866000042", "Arjun Mint");
        String ops = staff("9866000043");

        String original = slugOf(mint(first, body("Willow Crest D252 Baner"))
                .andExpect(status().isCreated()));
        String copy = slugOf(mint(second, body("Willow Crest D252"))
                .andExpect(status().isCreated()));

        // Two member-added rows, neither of which existed in the bundled catalogue. This is the
        // case the browser version could not see at all, and it is the only case the queue
        // produces.
        assertThat(original).isNotEqualTo(copy);
        String json = dupes(copy, ops)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].slug").value(original))
                .andExpect(jsonPath("$[0].name").value("Willow Crest D252 Baner"))
                .andExpect(jsonPath("$[0].verified").value(false))
                .andExpect(jsonPath("$[0].score")
                        .value(org.hamcrest.Matchers.greaterThanOrEqualTo(0.34)))
                .andReturn().getResponse().getContentAsString();

        // And the seeded catalogue does not drown it. "Willow Towers" reduces to the one
        // distinctive token `willow`, so scoring against the shorter name -- which is what the
        // browser did -- makes it a flat 1.0 match for anything on that root. Being RERA, it and
        // its four siblings are verified, so all five sorted above the actual duplicate and pushed
        // it off a six-item list. The operator would have seen six wrong answers.
        assertThat(json).doesNotContain("willow-towers").doesNotContain("willow-avenue");
    }

    @Test
    @DisplayName("a candidate never proposes itself as its own duplicate")
    void candidateIsNotItsOwnDuplicate() throws Exception {
        User author = user("9866000044", "Sneha Mint");
        String ops = staff("9866000045");
        String slug = slugOf(mint(author, body("Juniper Spur D252")).andExpect(status().isCreated()));

        // A perfect match for itself, and the one hint that is never useful.
        String json = dupes(slug, ops).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(json).doesNotContain("\"" + slug + "\"");
    }

    @Test
    @DisplayName("two societies sharing only a generic word are not proposed as duplicates")
    void genericWordsAreNotEvidence() throws Exception {
        User first = user("9866000046", "Rakesh Mint");
        User second = user("9866000047", "Divya Mint");
        String ops = staff("9866000048");

        String other = slugOf(mint(first, body("Marlowe Residency"))
                .andExpect(status().isCreated()));
        String mine = slugOf(mint(second, body("Ashgrove Residency"))
                .andExpect(status().isCreated()));

        // Every third building in Pune is a Residency. Counting the suffix as shared evidence fills
        // the column with pairs that have nothing in common, and an operator who reads three false
        // hints stops reading the fourth — which is the real one.
        assertThat(dupes(mine, ops).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString())
                .doesNotContain(other);
    }

    @Test
    @DisplayName("a society an operator already merged away is not proposed again")
    void mergedAwayRowsAreNotProposed() throws Exception {
        User first = user("9866000049", "Ganesh Mint");
        User second = user("9866000050", "Leela Mint");
        String ops = staff("9866000051");

        String survivor = slugOf(mint(first, body("Tamarind Bay D252"))
                .andExpect(status().isCreated()));
        String retired = slugOf(mint(second, body("Tamarind Bay D252 Kharadi"))
                .andExpect(status().isCreated()));

        mvc.perform(post("/admin/society-merges")
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"from\":\"" + retired + "\",\"into\":\"" + survivor + "\"}"))
                .andExpect(status().is2xxSuccessful());

        // The merged row still holds its slug and its name — nothing was deleted — so a naive scan
        // keeps proposing it, and the operator is told the pair they resolved last week is
        // unresolved.
        assertThat(dupes(survivor, ops).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString())
                .doesNotContain(retired);
    }

    @Test
    @DisplayName("a verified society outranks an unverified one that scores the same")
    void verifiedTargetsSortFirst() throws Exception {
        User first = user("9866000052", "Nandini Mint");
        User second = user("9866000053", "Pranav Mint");
        User third = user("9866000054", "Yash Mint");
        String ops = staff("9866000055");

        String unverified = slugOf(mint(first, body("Casuarina Ridge D252 Hadapsar"))
                .andExpect(status().isCreated()));
        String confirmed = slugOf(mint(second, body("Casuarina Ridge D252 Kothrud"))
                .andExpect(status().isCreated()));
        mvc.perform(post("/admin/society-candidates/" + confirmed + "/verify")
                        .header(HttpHeaders.AUTHORIZATION, ops))
                .andExpect(status().isOk());

        String mine = slugOf(mint(third, body("Casuarina Ridge D252"))
                .andExpect(status().isCreated()));

        // A merge canonicalises *into* the trusted row. Offering the unverified one first is how an
        // operator folds the confirmed record into the junk one, taking its listings, follows and
        // reviews with it.
        String json = dupes(mine, ops).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].slug").value(confirmed))
                .andExpect(jsonPath("$[0].verified").value(true))
                .andReturn().getResponse().getContentAsString();
        assertThat(json).contains(unverified);
    }

    @Test
    @DisplayName("a candidate that resembles nothing gets an empty list, not an error")
    void noMatchIsAnEmptyList() throws Exception {
        User author = user("9866000056", "Ishaan Mint");
        String ops = staff("9866000057");
        String slug = slugOf(mint(author, body("Zephyrine Quollhaven D252"))
                .andExpect(status().isCreated()));

        dupes(slug, ops).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @DisplayName("asking for the duplicates of a society that does not exist is a 404")
    void duplicatesOfUnknownSlugIs404() throws Exception {
        dupes("no-such-society-d252", staff("9866000058")).andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("the duplicate hints are staff-only")
    void duplicatesAreStaffOnly() throws Exception {
        User buyer = user("9866000059", "Anaya Mint");
        String slug = slugOf(mint(buyer, body("Peep Court D252")).andExpect(status().isCreated()));

        mvc.perform(get("/admin/society-candidates/" + slug + "/duplicates")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());

        mvc.perform(get("/admin/society-candidates/" + slug + "/duplicates"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("an impossible limit is refused rather than quietly rewritten")
    void duplicateLimitIsRefusedNotClamped() throws Exception {
        String ops = staff("9866000060");
        User owner = user("9866000061", "Rhea Mint");
        String slug = slugOf(mint(owner, body("Limit Court D252")).andExpect(status().isCreated()));

        /* `Math.max(1, limit)` stood in the service and answered a request nobody made: zero hints
           came back as one, and a thousand came back as however many cleared the floor, with
           nothing in the response saying the number had been changed. Refused now, the same way
           `?days=0` is refused on the analytics reports rather than widened to a day. */
        dupes(slug, ops, "?limit=0").andExpect(status().isBadRequest());
        dupes(slug, ops, "?limit=-3").andExpect(status().isBadRequest());
        dupes(slug, ops, "?limit=1000").andExpect(status().isBadRequest());

        // The bound itself is inclusive, and the default is well inside it.
        dupes(slug, ops, "?limit=25").andExpect(status().isOk());
        dupes(slug, ops, "").andExpect(status().isOk());
    }
}
