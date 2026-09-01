package com.punenest.api.identity.user;

import com.punenest.api.support.AbstractApiTest;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.security.JwtService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Contract + behavior proof for {@code GET/PATCH /auth/me}: owner-scoped reads, partial updates,
 * unauthenticated rejection, and validation. Tokens are minted directly via {@link JwtService} for a
 * saved user, so these tests don't depend on the OTP flow.
 */
class MeEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private User saveUser(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    @Test
    void getMeWithoutTokenReturns401Envelope() throws Exception {
        mvc.perform(get("/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("unauthorized"))
                .andExpect(jsonPath("$.status").value(401));
    }

    @Test
    void getMeReturnsOwnProfile() throws Exception {
        User u = saveUser("9876500701", "buyer");
        mvc.perform(get("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(u.getId().toString()))
                .andExpect(jsonPath("$.mobile").value("9876500701"))
                .andExpect(jsonPath("$.role").value("buyer"))
                .andExpect(jsonPath("$.name").value("Asha Patil"));
    }

    /**
     * A consumer has no back-office baseline, so the question does not apply and the key is absent
     * rather than empty. Asserted separately from the profile read above because "absent" and
     * "present but empty" are the two answers a console has to tell apart, and a test that only
     * checked the happy case would let them collapse.
     */
    @Test
    void getMeOmitsPermissionsForAConsumer() throws Exception {
        User u = saveUser("9876500704", "buyer");
        mvc.perform(get("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.permissions").doesNotExist());
    }

    /**
     * An unscoped administrator holds the whole catalogue, and the console draws its sidebar from
     * exactly this list. Two atoms are asserted by name rather than the whole set: the point is that
     * the field carries resolved {@code module:action} atoms, not that the catalogue has a
     * particular length today — pinning the count here would make every new permission fail an
     * identity test that has no opinion about permissions.
     */
    @Test
    void getMeCarriesResolvedAtomsForAnAdministrator() throws Exception {
        User u = saveUser("9876500705", "admin");
        mvc.perform(get("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.permissions").isArray())
                .andExpect(jsonPath("$.permissions", hasItem("users:read")))
                .andExpect(jsonPath("$.permissions", hasItem("settings:write")));
    }

    /**
     * The role ceiling, read back through the profile route. {@code settings:write} is admin-only,
     * so no staff account can hold it however its document is written — and a console that scoped
     * its navigation from anything but this resolved list would offer the tab anyway.
     */
    @Test
    void getMeNeverGrantsAnAdminOnlyAtomToStaff() throws Exception {
        User u = saveUser("9876500706", "staff");
        mvc.perform(get("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.permissions").isArray())
                .andExpect(jsonPath("$.permissions", hasItem("tickets:read")))
                .andExpect(jsonPath("$.permissions", not(hasItem("settings:write"))));
    }

    @Test
    void patchMeUpdatesEditableFields() throws Exception {
        User u = saveUser("9876500702", "owner");
        mvc.perform(patch("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Asha R. Patil\",\"email\":\"asha@example.com\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Asha R. Patil"))
                .andExpect(jsonPath("$.email").value("asha@example.com"))
                // untouched identity field is unchanged
                .andExpect(jsonPath("$.mobile").value("9876500702"));
    }

    @Test
    void patchMeWithInvalidEmailReturns422() throws Exception {
        User u = saveUser("9876500703", "buyer");
        mvc.perform(patch("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"not-an-email\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("validation_failed"))
                .andExpect(jsonPath("$.fields[0].field").value("email"));
    }

    /**
     * The owner privacy toggles, set and read back through the one route the profile screen uses.
     * Both directions are asserted because a boolean that can only be turned on is a trap: this
     * preference makes {@code ContactService#request} refuse every caller without an L2 badge, so an
     * owner who cannot clear it again is an owner whose enquiries have silently stopped arriving.
     */
    @Test
    void patchMeTogglesContactPrivacyPreferencesBothWays() throws Exception {
        User u = saveUser("9876500707", "owner");

        mvc.perform(patch("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"verifiedContactOnly\":true,\"hideNumber\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verifiedContactOnly").value(true))
                .andExpect(jsonPath("$.hideNumber").value(true));

        mvc.perform(patch("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"verifiedContactOnly\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verifiedContactOnly").value(false))
                // the other toggle was not mentioned, so it must have survived the write
                .andExpect(jsonPath("$.hideNumber").value(true));

        mvc.perform(get("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verifiedContactOnly").value(false))
                .andExpect(jsonPath("$.hideNumber").value(true));
    }

    /**
     * Null means unchanged, which for a boxed boolean is the whole reason it is boxed. A profile
     * save that only edits the name must not carry the privacy toggles back to their defaults —
     * that is how an owner who asked for verified callers only quietly stops getting the protection
     * they set, without ever touching the switch.
     */
    @Test
    void patchMeLeavesUnmentionedPrivacyPreferencesAlone() throws Exception {
        User u = saveUser("9876500708", "owner");
        u.setVerifiedContactOnly(true);
        u.setHideNumber(true);
        users.saveAndFlush(u);

        mvc.perform(patch("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Asha R. Patil\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Asha R. Patil"))
                .andExpect(jsonPath("$.verifiedContactOnly").value(true))
                .andExpect(jsonPath("$.hideNumber").value(true));
    }
}
