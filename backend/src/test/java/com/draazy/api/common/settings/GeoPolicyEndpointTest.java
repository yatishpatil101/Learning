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

/** Round trips (admin write, anonymous read) prove the read matches the write; the route must expose only geo, never the blacklist note. */
class GeoPolicyEndpointTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /** Audit rows written under {@code REQUIRES_NEW} commit past the class rollback; cleared by actor, not action,
     * because other tests legitimately write {@code settings.update}. */
    private static final String ADMIN_MOBILE = "9877730001";

    private String adminId;

    @AfterEach
    void clearAudit() {
        if (adminId != null) {
            jdbc.update("delete from audit_log where actor = ?", adminId);
        }
    }

    /** Created per test: {@code save()} runs twice in the merge test and admins can't share a mobile. */
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

    /** Reachable without Authorization: a 401 would silently fall back to built-in defaults. {@code geo} is
     * deliberately not seeded, as defaults live in the client. */
    @Test
    void anonymousCallersGetAnEmptyPolicyOnAnUnconfiguredInstall() throws Exception {
        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.cities").isMap())
                .andExpect(jsonPath("$.geo.cities").isEmpty())
                .andExpect(jsonPath("$.geo.blacklist").isArray())
                .andExpect(jsonPath("$.geo.blacklist").isEmpty())
                // Absent, not false. The client's default is on, and a `false` here would read as a
                // deliberate decision to unfence locality search on an install nobody has touched.
                .andExpect(jsonPath("$.geo.enforceCityLimit").doesNotExist());
    }

    /** Where a city centres and how far its Places fence extends are admin-owned, and must reach an anonymous browser from the server. */
    @Test
    void cityMapOverridesAreVisibleToAnAnonymousClient() throws Exception {
        save("""
                {"cities":{"Mumbai":{"center":{"lat":19.076,"lng":72.8777}}}}""");

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.cities.Mumbai.center.lat").value(19.076))
                .andExpect(jsonPath("$.geo.cities.Mumbai.center.lng").value(72.8777))
                .andExpect(jsonPath("$.geo.cities.Mumbai.live").doesNotExist());
    }

    /** The blacklist is public (matching runs in the browser) but the operator's reason is staff-to-staff text about a named building and must not be published. */
    @Test
    void theBlacklistIsPublishedWithoutTheOperatorsReason() throws Exception {
        save("""
                {"blacklist":[{"id":"bl1","placeId":"ChIJxyz","term":"Sunrise Towers",\
                "note":"Repeated fake listings, owner disputed","at":1730000000000}]}""");

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.blacklist[0].id").value("bl1"))
                .andExpect(jsonPath("$.geo.blacklist[0].placeId").value("ChIJxyz"))
                .andExpect(jsonPath("$.geo.blacklist[0].term").value("Sunrise Towers"))
                .andExpect(jsonPath("$.geo.blacklist[0].note").doesNotExist())
                // Asserted as a whole-response absence too, so a future field named `note` nested
                // anywhere under the list fails this test rather than shipping.
                .andExpect(jsonPath("$.geo..note").isEmpty());
    }

    /** An incomplete bounding box is dropped whole: forwarding three edges would give the client a fence with a gap, whereas the built-in box is closed. */
    @Test
    void anIncompleteBoundingBoxIsDroppedRatherThanForwarded() throws Exception {
        save("""
                {"cities":{"Pune":{"bounds":{"north":18.7,"east":74.0,"west":73.6}}}}""");

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.cities.Pune.bounds").doesNotExist());
    }

    /** An inverted bounding box is dropped: it encloses nothing, so the client's suggestion box would be silently empty, whereas the built-in bounds enclose the city. */
    @Test
    void anInvertedBoundingBoxEnclosesNothingAndIsDropped() throws Exception {
        save("""
                {"cities":{"Pune":{\
                "bounds":{"north":18.4,"south":18.7,"east":74.0,"west":73.6}}}}""");

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.cities.Pune.bounds").doesNotExist());
    }

    /** Clamping lat 200 to 90 would invent a deliberate-looking North Pole centre; dropping the
     * whole point falls back to the city's built-in centre. */
    @Test
    void aCoordinateOffTheGlobeIsDroppedRatherThanClamped() throws Exception {
        save("""
                {"cities":{"Pune":{"center":{"lat":200,"lng":73.85}}}}""");

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.cities.Pune.center").doesNotExist());
    }

    /** An empty {@code {"Nashik": {}}} would read as a configured override; absent matches every
     * unconfigured city. */
    @Test
    void aCityWhoseEveryOverrideWasRefusedIsOmitted() throws Exception {
        save("""
                {"cities":{"Nashik":{"center":{"lat":"north"}}}}""");

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.cities.Nashik").doesNotExist());
    }

    /** An entry that can match nothing is dropped; two characters is the shortest the client acts on, so the server must publish exactly those, as drift is silent. */
    @Test
    void blacklistEntriesThatCouldMatchNothingAreOmitted() throws Exception {
        save("""
                {"blacklist":[{"id":"bl1","term":"a"},{"id":"bl2","term":"Skyline"},\
                {"id":"bl3","term":"DY"}]}""");

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.blacklist.length()").value(2))
                .andExpect(jsonPath("$.geo.blacklist[0].id").value("bl2"))
                .andExpect(jsonPath("$.geo.blacklist[1].id").value("bl3"))
                .andExpect(jsonPath("$.geo.blacklist[1].term").value("DY"));
    }

    /** Asserted from the public response, as a merge regression would blank other cities for visitors without failing a write-side assertion. */
    @Test
    void editingOneCityLeavesTheOthersStanding() throws Exception {
        save("""
                {"enforceCityLimit":false,"cities":{"Pune":{"center":{"lat":18.55,"lng":73.86}},
                "Nashik":{"bounds":{"north":20.1,"south":19.9,"east":73.9,"west":73.6}}}}""");
        save("""
                {"cities":{"Nashik":{"center":{"lat":19.99,"lng":73.79}}}}""");

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.enforceCityLimit").value(false))
                .andExpect(jsonPath("$.geo.cities.Pune.center.lat").value(18.55))
                .andExpect(jsonPath("$.geo.cities.Nashik.bounds.north").value(20.1))
                .andExpect(jsonPath("$.geo.cities.Nashik.center.lat").value(19.99));
    }
}
