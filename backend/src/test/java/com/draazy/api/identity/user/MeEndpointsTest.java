package com.draazy.api.identity.user;

import com.draazy.api.support.AbstractApiTest;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.security.JwtService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Tokens are minted directly via {@link JwtService}, so these do not depend on the OTP flow.
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

    /** "Absent" and "present but empty" are the two answers a console has to tell apart. */
    @Test
    void getMeOmitsPermissionsForAConsumer() throws Exception {
        User u = saveUser("9876500704", "buyer");
        mvc.perform(get("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.permissions").doesNotExist());
    }

    /**
     * Two atoms by name rather than the whole set: the claim is that resolved {@code module:action}
     * atoms are carried, not that the catalogue has a particular length today.
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
     * The role ceiling: {@code settings:write} is admin-only however a staff document is written,
     * and a console scoping its navigation from anything but this list would offer the tab anyway.
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
     * The column has no length, so the browser was the only bound. A blank name is the trap: it
     * passes {@code @Size} while the "ask for a name" step fires on a trimmed-empty one forever.
     */
    @Test
    void patchMeRejectsANameOutsideItsBounds() throws Exception {
        User u = saveUser("9876500708", "buyer");

        mvc.perform(patch("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"A\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("name"));

        mvc.perform(patch("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + "a".repeat(81) + "\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("name"));

        mvc.perform(patch("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"   \"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("name"));

        // Omitting it entirely is still how you edit only the email, so null must stay legal.
        mvc.perform(patch("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"bounds@example.com\"}"))
                .andExpect(status().isOk());
    }

            @Test
            void patchMeMeasuresAndStoresTheTrimmedName() throws Exception {
                User u = saveUser("9876500709", "buyer");

                mvc.perform(patch("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"name\":\" A \"}"))
                        .andExpect(status().isUnprocessableEntity())
                        .andExpect(jsonPath("$.fields[0].field").value("name"));

                mvc.perform(patch("/auth/me").header(HttpHeaders.AUTHORIZATION, bearer(u))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"name\":\"  Asha Patil  \"}"))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.name").value("Asha Patil"));
            }

    /**
     * Both directions, because a boolean that can only be turned on is a trap: this preference makes
     * {@code ContactService#request} refuse every unverified caller, silently stopping enquiries.
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
     * Null means unchanged, which is why the field is boxed: a save that only edits the name must
     * not reset an owner's privacy toggles without them touching the switch.
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
