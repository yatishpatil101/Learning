package com.draazy.api.common.settings;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Contract + behaviour proof for {@code GET /geo}.
 *
 * <p><strong>The endpoint exists because the write was real and the read was not.</strong> The
 * admin console's Maps panel saved to the settings document and was told it succeeded, because it
 * had; every consumer then read a stale copy out of its own browser's local storage. So the
 * assertions that carry weight are the round trips — a bounding box redrawn, a map recentered, a
 * place blacklisted — each written by an admin and read back with no token, because that is the
 * pairing the old arrangement broke. City launch state is now proved on {@code /cities} and its
 * admin write route instead.
 *
 * <p>The other half is what the route refuses to say. It is anonymous, and the block it projects
 * sits in a document holding the fee table and the permission map, so "only geo" is asserted as
 * absences. Narrower still: the operator's free-text reason on each blacklist entry is moderator
 * prose about a named building, and no test here is allowed to find it on the wire.
 */
class GeoPolicyEndpointTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /**
     * The admin whose saves this test makes.
     *
     * <p>Every {@code save()} below goes through {@code PUT /admin/settings}, and
     * {@code AuditService} writes under {@code REQUIRES_NEW} — so those rows commit straight past
     * this class's rollback and would otherwise pile up in a developer's database, run after run.
     * Cleared by actor rather than by action, because {@code settings.update} is a row other tests
     * legitimately write and none of them are this test's to remove.
     */
    private static final String ADMIN_MOBILE = "9877730001";

    /**
     * The admin's id, kept so this test's audit rows can be found again.
     */
    private String adminId;

    @AfterEach
    void clearAudit() {
        if (adminId != null) {
            jdbc.update("delete from audit_log where actor = ?", adminId);
        }
    }

    /**
     * Created once per test, not once per call — {@code save()} is used twice in the merge test and
     * two admins cannot share a mobile number.
     */
    private String adminToken;

    private String adminToken() {
        if (adminToken == null) {
            User u = new User(ADMIN_MOBILE, Roles.Wire.ADMIN);
            u.setName("Geo Admin");
            u.setMobileVerified(true);
            User saved = users.saveAndFlush(u);
            adminId = saved.getId().toString();
            adminToken = "Bearer " + jwtService.issueAccessToken(saved);
        }
        return adminToken;
    }

    private void save(String geoJson) throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"geo\":" + geoJson + "}"))
                .andExpect(status().isOk());
    }

    /**
     * Reachable with no Authorization header, and an install nobody has configured gets the empty
     * policy rather than an error.
     *
     * <p>Two properties in one request. The first is the route-constant/security-matcher agreement
     * check that {@code /flags} also makes, and it fails the same silent way: a 401 here does not
     * break a page, it makes every city fall back to a built-in default, so the site keeps working
     * while the Maps panel quietly stops being connected to anything.
     *
     * <p>The second is that {@code geo} is deliberately <em>not</em> seeded, unlike {@code fees},
     * {@code flags} and {@code movePack}. Defaults for this block live in the client, so a seeded
     * row would be a second source of truth. Empty collections rather than nulls, so the client
     * never has to distinguish "no overrides" from "no answer".
     */
    @Test
    void anonymousCallersGetAnEmptyPolicyOnAnUnconfiguredInstall() throws Exception {
        mvc.perform(get(Routes.Geo.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cities").isMap())
                .andExpect(jsonPath("$.cities").isEmpty())
                .andExpect(jsonPath("$.blacklist").isArray())
                .andExpect(jsonPath("$.blacklist").isEmpty())
                // Absent, not false. The client's default is on, and a `false` here would read as a
                // deliberate decision to unfence locality search on an install nobody has touched.
                .andExpect(jsonPath("$.enforceCityLimit").doesNotExist());
    }

    /**
     * A city's map overrides are visible to a visitor with no account.
     *
     * <p>The route still exists for the two facts the browser cannot bundle honestly: where a city
     * centres and how far its Places fence extends. Those remain admin-owned settings and have to
     * reach an anonymous browser from the server.
     */
    @Test
    void cityMapOverridesAreVisibleToAnAnonymousClient() throws Exception {
        save("""
                {"cities":{"Mumbai":{"center":{"lat":19.076,"lng":72.8777}}}}""");

        mvc.perform(get(Routes.Geo.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cities.Mumbai.center.lat").value(19.076))
                .andExpect(jsonPath("$.cities.Mumbai.center.lng").value(72.8777))
                .andExpect(jsonPath("$.cities.Mumbai.live").doesNotExist());
    }

    /**
     * The blacklist reaches the client, and the operator's reason does not.
     *
     * <p>The load-bearing privacy assertion. The list itself has to be public — the matching runs in
     * the browser, inside the suggestion box, as the visitor types — but it only ever consumes
     * {@code placeId} and {@code term}. The note is the panel's "Reason (optional)": staff writing
     * to staff about a named building, which is the same class of text as a moderator's flag
     * reason. Publishing it would tell anyone who opened the network tab why a specific society was
     * suppressed.
     */
    @Test
    void theBlacklistIsPublishedWithoutTheOperatorsReason() throws Exception {
        save("""
                {"blacklist":[{"id":"bl1","placeId":"ChIJxyz","term":"Sunrise Towers",\
                "note":"Repeated fake listings, owner disputed","at":1730000000000}]}""");

        mvc.perform(get(Routes.Geo.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.blacklist[0].id").value("bl1"))
                .andExpect(jsonPath("$.blacklist[0].placeId").value("ChIJxyz"))
                .andExpect(jsonPath("$.blacklist[0].term").value("Sunrise Towers"))
                .andExpect(jsonPath("$.blacklist[0].note").doesNotExist())
                // Asserted as a whole-response absence too, so a future field named `note` nested
                // anywhere under the list fails this test rather than shipping.
                .andExpect(jsonPath("$..note").isEmpty());
    }

    /**
     * The projection is the {@code geo} row and nothing else.
     *
     * <p>Same shape of assertion {@code /flags} makes, and for the same reason: the justification
     * for a public route is that this one block is not sensitive while its neighbours are. Widening
     * it into "the public settings endpoint" is the mistake this test is positioned to catch.
     */
    @Test
    void nothingButTheGeoBlockIsPublished() throws Exception {
        mvc.perform(get(Routes.Geo.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fees").doesNotExist())
                .andExpect(jsonPath("$.permissions").doesNotExist())
                .andExpect(jsonPath("$.adminFlags").doesNotExist())
                .andExpect(jsonPath("$.flags").doesNotExist())
                .andExpect(jsonPath("$.site").doesNotExist());
    }

    /**
     * An incomplete bounding box is dropped whole, not published with the edges it has.
     *
     * <p>This is the one malformed-value case with teeth. With the city limit on, the client turns
     * these four numbers into a hard {@code locationRestriction} on the Places request. Forwarding
     * three of them would not narrow the search — it would produce a fence with a gap, and the
     * suggestions would quietly start including the next district. Dropping the box falls back to
     * the built-in one, which is closed.
     *
     * <p>No sibling field survives because launch state no longer travels on this route.
     */
    @Test
    void anIncompleteBoundingBoxIsDroppedRatherThanForwarded() throws Exception {
        save("""
                {"cities":{"Pune":{"bounds":{"north":18.7,"east":74.0,"west":73.6}}}}""");

        mvc.perform(get(Routes.Geo.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cities.Pune.bounds").doesNotExist());
    }

    /**
     * An inverted bounding box is dropped too — the failure the previous test's sibling.
     *
     * <p>A box whose north edge is below its south encloses nothing, so the client's
     * {@code withinBounds} refuses every candidate and the suggestion box for that city goes
     * permanently, silently empty. That is worse than the gap above: a fence with a hole lets
     * strangers in, a fence with no interior locks everybody out, and neither announces itself.
     * Dropping it returns the city to its built-in bounds, which enclose the city.
     */
    @Test
    void anInvertedBoundingBoxEnclosesNothingAndIsDropped() throws Exception {
        save("""
                {"cities":{"Pune":{\
                "bounds":{"north":18.4,"south":18.7,"east":74.0,"west":73.6}}}}""");

        mvc.perform(get(Routes.Geo.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cities.Pune.bounds").doesNotExist());
    }

    /**
     * A coordinate outside the coordinate system is dropped rather than clamped.
     *
     * <p>There is no latitude 200. Clamping it to 90 would invent a centre the operator never named
     * and put it at the North Pole, where it would look deliberate; dropping the point falls back to
     * the built-in centre of the city they were editing. The longitude beside it is valid and goes
     * with it, because half a point is not a point.
     */
    @Test
    void aCoordinateOffTheGlobeIsDroppedRatherThanClamped() throws Exception {
        save("""
                {"cities":{"Pune":{"center":{"lat":200,"lng":73.85}}}}""");

        mvc.perform(get(Routes.Geo.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cities.Pune.center").doesNotExist());
    }

    /**
     * A city whose every field was refused is left out of the map entirely.
     *
     * <p>The alternative is an entry that says nothing — {@code {"Nashik": {}}} — which the client
     * would read as an override and find empty, and which a person reading the response would take
     * as evidence the operator had configured something. Absent is the honest answer, and it is the
     * one every unconfigured city already gives.
     */
    @Test
    void aCityWhoseEveryOverrideWasRefusedIsOmitted() throws Exception {
        save("""
                {"cities":{"Nashik":{"center":{"lat":"north"}}}}""");

        mvc.perform(get(Routes.Geo.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cities.Nashik").doesNotExist());
    }

    /**
     * An entry that can match nothing is not published.
     *
     * <p>The client refuses to substring-match a term shorter than two characters, because one
     * character matches most of Pune. So a row holding only {@code "a"} — and no place id — is
     * inert wherever it goes, and putting it in a list whose only purpose is to be matched against
     * invites a reader to think something is being suppressed. Its well-formed neighbour survives,
     * so this is a filter and not a rejection of the whole list.
     *
     * <p>The third row pins the boundary itself. Two characters is the shortest the client will act
     * on, and it must be published: the two constants are in different languages with only a comment
     * holding them together, and drift in this direction is silent — the server would withhold
     * entries the client was ready to match, and no operator would ever learn their blacklist had
     * been quietly trimmed.
     */
    @Test
    void blacklistEntriesThatCouldMatchNothingAreOmitted() throws Exception {
        save("""
                {"blacklist":[{"id":"bl1","term":"a"},{"id":"bl2","term":"Skyline"},\
                {"id":"bl3","term":"DY"}]}""");

        mvc.perform(get(Routes.Geo.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.blacklist.length()").value(2))
                .andExpect(jsonPath("$.blacklist[0].id").value("bl2"))
                .andExpect(jsonPath("$.blacklist[1].id").value("bl3"))
                .andExpect(jsonPath("$.blacklist[1].term").value("DY"));
    }

    /**
     * The merge is deep, so editing one city does not blank the others.
     *
     * <p>Asserted from the public response rather than the admin one because this is what a visitor
     * renders from: a merge regression would take every other city off the map without failing any
     * assertion on the write side. {@code geo.blacklist} is the reason arrays replace whole rather
     * than merging index-wise, and that half is worth pinning here too.
     */
    @Test
    void editingOneCityLeavesTheOthersStanding() throws Exception {
        save("""
                {"enforceCityLimit":false,"cities":{"Pune":{"center":{"lat":18.55,"lng":73.86}},
                "Nashik":{"bounds":{"north":20.1,"south":19.9,"east":73.9,"west":73.6}}}}""");
        save("""
                {"cities":{"Nashik":{"center":{"lat":19.99,"lng":73.79}}}}""");

        mvc.perform(get(Routes.Geo.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enforceCityLimit").value(false))
                .andExpect(jsonPath("$.cities.Pune.center.lat").value(18.55))
                .andExpect(jsonPath("$.cities.Nashik.bounds.north").value(20.1))
                .andExpect(jsonPath("$.cities.Nashik.center.lat").value(19.99));
    }
}
