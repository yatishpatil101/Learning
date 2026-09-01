package com.draazy.api.common.settings;

import com.draazy.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Contract + behaviour proof for {@code GET /flags}.
 *
 * <p><strong>The endpoint is one line of logic, and every property worth proving is about who may
 * call it and what it refuses to say.</strong> It exists because the flag block gates what a
 * logged-out visitor sees while the document it lives in is admin-only, so the two load-bearing
 * assertions are the two halves of that sentence: an anonymous caller gets the flags, and an
 * anonymous caller gets <em>only</em> the flags. A regression in either direction is silent —
 * requiring a token makes the whole site render its defaults, and widening the projection leaks the
 * fee table and the permission map to the internet.
 *
 * <p>The third is the round trip. A kill switch nobody reads is the defect this route was built to
 * end, so it is not enough that the route answers: what an admin saves through
 * {@code PUT /admin/settings} has to be what an anonymous client subsequently reads.
 */
class AppFlagsEndpointTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String adminToken() {
        User u = new User("9877720001", Roles.Wire.ADMIN);
        u.setName("Flags Admin");
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    /**
     * Reachable with no Authorization header, and carrying the seeded toggles.
     *
     * <p>This is the route-constant/security-matcher agreement check: a route mapped in the
     * controller but missed in {@code SecurityConfig} would 401 here. It matters more than usual
     * because the failure is invisible from the client — a 401 on this endpoint does not break a
     * page, it makes every flag fall back to its default, so the site keeps working while the
     * toggles quietly stop being connected to anything.
     */
    @Test
    void anonymousCallersGetTheSeededFlags() throws Exception {
        mvc.perform(get(Routes.Flags.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kycBadgeEnabled").value(true))
                .andExpect(jsonPath("$.boostEnabled").value(true))
                .andExpect(jsonPath("$.maintenanceMode").value(false));
    }

    /**
     * The projection is the {@code flags} row and nothing else.
     *
     * <p>The whole justification for a public route is that this one block is not sensitive while
     * its neighbours are. So the assertion is written as absences: the fee table, the permission
     * map, the back-office toggles and the branding block are all in the same document and none of
     * them may appear here. Widening this endpoint to "the public settings endpoint" is the exact
     * mistake this test is positioned to catch.
     */
    @Test
    void nothingButTheFlagBlockIsPublished() throws Exception {
        mvc.perform(get(Routes.Flags.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fees").doesNotExist())
                .andExpect(jsonPath("$.permissions").doesNotExist())
                .andExpect(jsonPath("$.adminFlags").doesNotExist())
                .andExpect(jsonPath("$.site").doesNotExist())
                .andExpect(jsonPath("$.geo").doesNotExist());
    }

    /**
     * What the admin saves is what the anonymous client reads.
     *
     * <p>The reason the route was built. Before it, {@code PUT /admin/settings} stored the value
     * faithfully and the browser read a copy out of local storage, so maintenance mode reported
     * success and served the site anyway. Toggling the most dangerous flag and reading it back
     * without a token is the narrowest proof that the write and the read are now the same value.
     */
    @Test
    void aFlagSavedByAnAdminIsVisibleToAnAnonymousClient() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flags\":{\"maintenanceMode\":true,\"mapSearch\":false}}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Flags.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.maintenanceMode").value(true))
                .andExpect(jsonPath("$.mapSearch").value(false))
                // The merge is deep (S60), so the flags the panel did not touch survive. Asserted
                // here rather than left to the settings test because this is the response the
                // client actually renders from: a merge regression would blank the site's features
                // without failing any admin-side assertion.
                .andExpect(jsonPath("$.kycBadgeEnabled").value(true));
    }

    /**
     * A non-boolean is dropped rather than forwarded.
     *
     * <p>The contract types this map as booleans. A hand-edited row holding the string
     * {@code "false"} would read as <em>enabled</em> on the client either way — {@code "false" !==
     * false} — so forwarding it buys no behaviour and makes the response disagree with its own
     * schema. Dropping it keeps the wire honest at zero cost.
     */
    @Test
    void nonBooleanValuesAreOmitted() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flags\":{\"emiCalculator\":\"false\",\"reviewsEnabled\":false}}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Flags.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.emiCalculator").doesNotExist())
                .andExpect(jsonPath("$.reviewsEnabled").value(false));
    }
}
