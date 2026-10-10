package com.draazy.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.draazy.api.identity.user.User;
import com.draazy.api.provider.PlacesLookup;
import com.draazy.api.provider.PlacesLookup.Place;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/** The duplicate guard must hold on the name as well as the slug, as the slug folds the locality in. */
@DisplayName("Societies — community minting")
class SocietyMintTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @MockitoBean PlacesLookup places;

    @BeforeEach
    void googleEchoesTheHint() {
        when(places.details(any(), any())).thenAnswer(call -> {
            Place hint = call.getArgument(1);
            return hint != null && hint.name() != null && !hint.name().isBlank()
                    ? Optional.of(hint) : Optional.empty();
        });
    }

    /** Mobile block 98660000xx is used by no other class; no {@code REQUIRES_NEW} provisioning,
     * so the class-level rollback needs no cleanup. */
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
        return bearer(users.saveAndFlush(u));
    }

    private ResultActions mint(User u, String json) throws Exception {
        return mvc.perform(post("/societies")
                .header(HttpHeaders.AUTHORIZATION, bearer(u))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json));
    }

    private static String body(String name) {
        return "{\"placeId\":\"" + placeIdOf(name) + "\",\"name\":\"" + name + "\"}";
    }

    private static String placeIdOf(String name) {
        return "test-" + name.trim().toLowerCase().replaceAll("\\s+", "-");
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
                        + " registration, conveyance"
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

        ResultActions created = mint(author, "{\"placeId\":\"test-sunview-d241\","
                + "\"name\":\"Sunview Heights D241\",\"localityLabel\":\"Wakad\",\"lat\":18.598,\"lng\":73.762}");
        created.andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Sunview Heights D241"))
                .andExpect(jsonPath("$.source").doesNotExist());

        String slug = slugOf(created);
        // The locality is folded into the slug so two societies of the same name in different
        // suburbs do not collide.
        assertThat(slug).isEqualTo("sunview-heights-d241-wakad");

        // Findable by a completely different, anonymous reader in the very next request. This is
        // the whole point: the browser-local version was visible to exactly one person.
        mvc.perform(get("/societies/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Sunview Heights D241"));

        mvc.perform(get("/societies").param("q", "Sunview Heights D241"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].slug").value(slug));

        Map<String, Object> stored = row(slug);
        assertThat(stored.get("created_by")).isEqualTo(author.getId());
        assertThat(stored.get("source")).isEqualTo("community");
        // The pin the caller supplied is kept — it is usually better than the locality centroid.
        assertThat(((Number) stored.get("lat")).doubleValue()).isEqualTo(18.598);
    }

    @Test
    @DisplayName("a locality slug that is not live is refused, not stored as a broken reference")
    void unknownLocalityIsRefused() throws Exception {
        User author = user("9866000003", "Tanvi Mint");

        // `societies.locality_slug` is a foreign key. An area the caller invented is not a field we
        // can store; it is a constraint violation, and a 500 on a form filled in correctly.
        mint(author, "{\"placeId\":\"test-marigold-d241\","
                + "\"name\":\"Marigold Enclave D241\",\"localitySlug\":\"not-a-real-locality-d241\"}")
                .andExpect(status().isUnprocessableEntity());
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
    @DisplayName("a society can only be added from a Google place pick")
    void mintRequiresAPlaceId() throws Exception {
        User author = user("9866000070", "Pia Mint");
        mint(author, "{\"name\":\"Typed Towers D241\"}").andExpect(status().isUnprocessableEntity());
        mint(author, "{\"placeId\":\"  \",\"name\":\"Typed Towers D241\"}")
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("the stored name and pin are Google's, not whatever the client sent")
    void mintUsesWhatGoogleSays() throws Exception {
        User author = user("9866000071", "Quin Mint");
        when(places.details(eq("test-g-1"), any())).thenReturn(Optional.of(
                new Place("test-g-1", "Google Named Towers D241", 18.5601, 73.8002, "411045", List.of("premise"))));

        ResultActions created = mint(author, "{\"placeId\":\"test-g-1\",\"name\":\"Client Typed Name\","
                + "\"lat\":18.6,\"lng\":73.9}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Google Named Towers D241"));

        Map<String, Object> stored = row(slugOf(created));
        assertThat(((Number) stored.get("lat")).doubleValue()).isEqualTo(18.5601);
        assertThat(((Number) stored.get("lng")).doubleValue()).isEqualTo(73.8002);
        assertThat(jdbc.queryForObject("select place_id from societies where slug = ?", String.class,
                slugOf(created))).isEqualTo("test-g-1");
    }

    @Test
    @DisplayName("the same place twice is one society: 201 then 200")
    void mintIsIdempotentByPlace() throws Exception {
        User first = user("9866000072", "Rue Mint");
        User second = user("9866000073", "Sol Mint");
        String id = idOf(mint(first, body("Idem Towers D241")).andExpect(status().isCreated()));

        // Even with a different typed name: the place is the identity.
        String again = "{\"placeId\":\"" + placeIdOf("Idem Towers D241") + "\",\"name\":\"Other Spelling\"}";
        assertThat(idOf(mint(second, again).andExpect(status().isOk()))).isEqualTo(id);

        assertThat(jdbc.queryForObject("select count(*) from societies where place_id = ?", Integer.class,
                placeIdOf("Idem Towers D241"))).isOne();
    }

    @Test
    @DisplayName("two places with the same Google name get distinct slugs")
    void slugCollisionGetsASuffix() throws Exception {
        User author = user("9866000074", "Tai Mint");
        for (String id : List.of("test-twin-a", "test-twin-b")) {
            when(places.details(eq(id), any())).thenReturn(Optional.of(
                    new Place(id, "Twin Court D241", 18.5, 73.8, null, List.of("premise"))));
        }
        String a = slugOf(mint(author, "{\"placeId\":\"test-twin-a\"}").andExpect(status().isCreated()));
        String b = slugOf(mint(author, "{\"placeId\":\"test-twin-b\"}").andExpect(status().isCreated()));
        assertThat(a).isEqualTo("twin-court-d241");
        assertThat(b).startsWith("twin-court-d241-").isNotEqualTo(a);
    }

    @Test
    @DisplayName("an area is refused: pick the building")
    void areaTypesAreRefused() throws Exception {
        User author = user("9866000075", "Uma Mint");
        when(places.details(eq("test-area"), any())).thenReturn(Optional.of(
                new Place("test-area", "Baner", 18.559, 73.78, null, List.of("sublocality_level_1", "political"))));

        mint(author, "{\"placeId\":\"test-area\",\"name\":\"Baner\"}")
                .andExpect(status().isUnprocessableEntity());
        assertThat(jdbc.queryForObject("select count(*) from societies where place_id = 'test-area'",
                Integer.class)).isZero();
    }

    @Test
    @DisplayName("a place Google does not know is refused")
    void unknownPlaceIsRefused() throws Exception {
        User author = user("9866000076", "Val Mint");
        when(places.details(eq("test-nowhere"), any())).thenReturn(Optional.empty());
        mint(author, "{\"placeId\":\"test-nowhere\",\"name\":\"Ghost Towers\"}")
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("adding a society needs an account")
    void mintNeedsAnAccount() throws Exception {
        mvc.perform(post("/societies")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("Anonymous Towers D241")))
                .andExpect(status().isUnauthorized());
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("a blank name is refused rather than stored as an unnamed building")
    @CsvSource(delimiter = '|', value = {
            "a blank name is refused | '   '"
    })
    void tooShortOrBlankNameIsRefused(String label, String name) throws Exception {
        User author = user("9866000008", "Rhea Mint");
        mint(author, body(name)).andExpect(status().isUnprocessableEntity());
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

    /** A mint stating which surface the caller was on; {@code origin} is sent raw so a bad value can be tested. */
    private static String bodyFrom(String name, String origin) {
        return "{\"placeId\":\"" + placeIdOf(name) + "\",\"name\":\"" + name
                + "\",\"mintOrigin\":\"" + origin + "\"}";
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("mint origin round-trips, and an omitted one defaults to listing")
    @CsvSource(delimiter = '|', value = {
            "a society a searcher asked for is stored as demand | Aster Bloom D241 | demand | demand",
            "a society a lister added is stored as coming from a listing | Basil Court D241 | listing | listing",
            "a client that has never heard of mint origin can still add a society | Cinnamon Rise D241 | NONE | listing"
    })
    void originRoundTrips(String label, String name, String sent, String expected) throws Exception {
        User author = user("9866000024", "Farhan Mint");

        // Old clients send none; it defaults to `listing` so demand can be under-reported but never invented.
        ResultActions created = mint(author, "NONE".equals(sent) ? body(name) : bodyFrom(name, sent))
                .andExpect(status().isCreated());

        assertThat(row(slugOf(created)).get("mint_origin")).isEqualTo(expected);
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("an origin nobody defined is refused rather than stored and silently ignored")
    @CsvSource(delimiter = '|', value = {
            "a wrongly cased origin is refused | Damson Park D241 | Demand | false",
            "an unknown origin is refused | Damson Park D241 | search | false",
            "a bad origin is refused even when the society already exists | Elder Row D241 | nonsense | true"
    })
    void unknownOriginIsRefused(String label, String name, String origin, boolean alreadyExists)
            throws Exception {
        User author = user("9866000027", "Zoya Mint");
        if (alreadyExists) {
            mint(author, bodyFrom(name, "listing")).andExpect(status().isCreated());
        }

        // Validated in code, not left to the DB CHECK: an admitted unknown value would never match `demand`;
        // it must fire on the duplicate path too.
        mint(author, bodyFrom(name, origin)).andExpect(status().isUnprocessableEntity());

        Integer minted = jdbc.queryForObject(
                "select count(*) from societies where lower(name) = lower(?)", Integer.class, name);
        assertThat(minted).isEqualTo(alreadyExists ? 1 : 0);
    }

    @Test
    @DisplayName("reaching a society somebody already listed in does not rewrite how it got here")
    void matchingAnExistingSocietyKeepsItsOrigin() throws Exception {
        User lister = user("9866000029", "Harsh Mint");
        User searcher = user("9866000030", "Ira Mint");

        String slug = slugOf(mint(lister, bodyFrom("Fennel Heights D241", "listing"))
                .andExpect(status().isCreated()));

        // Real demand, deliberately not recorded: overwriting `listing` would say no flat was ever posted there.
        mint(searcher, bodyFrom("Fennel Heights D241", "demand"))
                .andExpect(status().isOk());

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
        assertThat(json).doesNotContain("amanora-park-hadapsar");
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

        // The queue is the only reader; "somebody wants a flat here and there are none" is the signal.
        String json = mvc.perform(get("/admin/society-candidates")
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .param("size", "100"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(originIn(json, wanted)).isEqualTo("demand");
        assertThat(originIn(json, posted)).isEqualTo("listing");
    }

    @Test
    @DisplayName("the candidates queue is paged and searched on the server")
    void queueIsPagedAndSearchedServerSide() throws Exception {
        User author = user("9866000041", "Lata Mint");
        String ops = staff("9866000042");
        String wanted = slugOf(mint(author, body("Quillon Meadows D245")).andExpect(status().isCreated()));
        mint(author, body("Rowan Meadows D245")).andExpect(status().isCreated());

        mvc.perform(get("/admin/society-candidates")
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .param("q", "quillon meadows").param("size", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].slug").value(wanted))
                .andExpect(jsonPath("$.content[0].mergedBy").doesNotExist());

        mvc.perform(get("/admin/society-candidates")
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .param("q", "meadows d245").param("size", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.totalPages").value(2));
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

    // ------------------------------------------------------ duplicate hints

    /** The duplicate column read before verifying; candidates are member-added rows no bundled file covers. */
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

        // Two member-added rows: the only kind of duplicate the queue actually produces.
        assertThat(original).isNotEqualTo(copy);
        String json = dupes(copy, ops)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].slug").value(original))
                .andExpect(jsonPath("$[0].name").value("Willow Crest D252 Baner"))
                .andExpect(jsonPath("$[0].score")
                        .value(org.hamcrest.Matchers.greaterThanOrEqualTo(0.34)))
                .andReturn().getResponse().getContentAsString();

        // Scoring against the shorter name makes "Willow Towers" a flat 1.0 match on `willow`, so verified
        // siblings would crowd the real duplicate off the list.
        assertThat(json).doesNotContain("willow-towers").doesNotContain("willow-avenue");
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

        // A shared suffix like Residency isn't evidence; counting it breeds false hints operators learn to skip.
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

        // A merged row keeps its slug and name, so a naive scan would keep proposing an already-resolved pair.
        assertThat(dupes(survivor, ops).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString())
                .doesNotContain(retired);
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

        /* A limit of 0 or 1000 is refused rather than silently clamped, as `?days=0` is on analytics reports:
           the response must not hide that the number was changed. */
        dupes(slug, ops, "?limit=0").andExpect(status().isBadRequest());
        dupes(slug, ops, "?limit=-3").andExpect(status().isBadRequest());
        dupes(slug, ops, "?limit=1000").andExpect(status().isBadRequest());

        // The bound itself is inclusive, and the default is well inside it.
        dupes(slug, ops, "?limit=25").andExpect(status().isOk());
        dupes(slug, ops, "").andExpect(status().isOk());
    }

    @Test
    @DisplayName("Google's canonical id is what is stored, and a second alias of it finds the same society")
    void canonicalIdIsStored() throws Exception {
        User author = user("9866000077", "Canon Mint");
        when(places.details(any(), any())).thenReturn(Optional.of(
                new Place("test-canonical-1", "Canon Towers D254", 18.5601, 73.8002, null, List.of("premise"))));

        String id = idOf(mint(author, "{\"placeId\":\"test-alias-1\",\"name\":\"Canon Towers D254\"}")
                .andExpect(status().isCreated()));
        assertThat(idOf(mint(author, "{\"placeId\":\"test-alias-2\",\"name\":\"Canon Towers D254\"}")
                .andExpect(status().isOk()))).isEqualTo(id);

        assertThat(jdbc.queryForObject("select place_id from societies where id = ?::uuid", String.class, id))
                .isEqualTo("test-canonical-1");
    }

    @Test
    @DisplayName("when the lookup is down the member gets a clean 422, not a 500")
    void lookupOutageIsAGracefulError() throws Exception {
        User author = user("9866000078", "Down Mint");
        when(places.details(any(), any())).thenThrow(new PlacesLookup.UnavailableException("no key", null));

        mint(author, body("Outage Towers D254"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value("Adding societies is temporarily unavailable."));
    }


    private static String bodyAt(String name, double lat, double lng) {
        return "{\"placeId\":\"" + placeIdOf(name) + "\",\"name\":\"" + name
                + "\",\"lat\":" + lat + ",\"lng\":" + lng + "}";
    }

    private void googleSays(String name, double lat, double lng, String... types) {
        when(places.details(any(), any())).thenReturn(Optional.of(
                new Place(placeIdOf(name), name, lat, lng, null, List.of(types))));
    }

    @Test
    @DisplayName("twenty Google lookups a day per member, then a 429; a place already held is free")
    void lookupsAreBudgetedPerMember() throws Exception {
        User busy = user("9866000070", "Budget Mint");
        for (int i = 0; i < 20; i++) {
            mint(busy, body("Budget Tower D253 " + i)).andExpect(status().isCreated());
        }

        mint(busy, body("Budget Tower D253 20")).andExpect(status().isTooManyRequests());
        mint(busy, body("Budget Tower D253 3")).andExpect(status().isOk());
        mint(user("9866000071", "Other Mint"), body("Budget Tower D253 21")).andExpect(status().isCreated());
    }

    @Test
    @DisplayName("staff are not held to the member lookup budget")
    void staffAreExempt() throws Exception {
        User ops = new User("9866000072", Roles.Wire.STAFF);
        ops.setName("Ops Budget");
        ops.setMobileVerified(true);
        ops = users.saveAndFlush(ops);
        for (int i = 0; i < 22; i++) {
            mint(ops, body("Staff Tower D253 " + i)).andExpect(status().isCreated());
        }
    }

    @Test
    @DisplayName("a pin outside the served city is refused before Google is asked")
    void outOfAreaHintNeverReachesGoogle() throws Exception {
        User member = user("9866000073", "Away Mint");

        mint(member, bodyAt("Marine Drive Court D253", 19.0760, 72.8777))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value("We only list societies in cities we serve."));
        verify(places, never()).details(any(), any());
    }

    @Test
    @DisplayName("a place Google locates outside the served city is refused too")
    void outOfAreaGoogleLocationIsRefused() throws Exception {
        User member = user("9866000074", "Far Mint");
        googleSays("Faraway Heights D253", 19.0760, 72.8777, "premise");

        mint(member, body("Faraway Heights D253"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value("We only list societies in cities we serve."));
    }

    @Test
    @DisplayName("a shop or restaurant is not a society, but a building that also holds one is")
    void nonResidentialPlacesAreRefused() throws Exception {
        User member = user("9866000075", "Shop Mint");

        googleSays("Cafe Quollhaven D253", 18.5204, 73.8567, "cafe", "food", "point_of_interest", "establishment");
        mint(member, body("Cafe Quollhaven D253"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value("Pick your building, not a shop or office."));

        googleSays("Mall Residency D253", 18.5204, 73.8567, "shopping_mall", "premise");
        mint(member, body("Mall Residency D253")).andExpect(status().isCreated());
    }

    @Test
    @DisplayName("a malformed place id, pin or contact-bearing name is a 422")
    void malformedMintFieldsAreRefused() throws Exception {
        User member = user("9866000076", "Shape Mint");

        mint(member, "{\"placeId\":\"stub bad id\",\"name\":\"Shape Court D253\"}")
                .andExpect(status().isUnprocessableEntity());
        mint(member, "{\"placeId\":\"" + "a".repeat(256) + "\",\"name\":\"Shape Court D253\"}")
                .andExpect(status().isUnprocessableEntity());
        mint(member, bodyAt("Shape Court D253", 95, 73.8)).andExpect(status().isUnprocessableEntity());
        mint(member, "{\"placeId\":\"test-shape\",\"name\":\"Call 9876543210 Court\"}")
                .andExpect(status().isUnprocessableEntity());
        verify(places, never()).details(any(), any());
    }

    @Test
    @DisplayName("resolve refuses out-of-range pins, over-long names and ids that are not Place IDs")
    void resolveValidatesItsInput() throws Exception {
        mvc.perform(get("/societies/resolve").param("placeId", "ok-id").param("lat", "95").param("lng", "73"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/societies/resolve").param("placeId", "ok-id").param("lat", "18").param("lng", "181"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/societies/resolve").param("placeId", "ok-id").param("name", "x".repeat(161)))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/societies/resolve").param("placeId", "has space"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/societies/resolve").param("placeId", "a".repeat(256)))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/societies/resolve").param("placeId", "ok-id"))
                .andExpect(status().isOk());
    }
}
