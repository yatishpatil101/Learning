package com.punenest.api.identity.user;

import com.punenest.api.support.AbstractApiTest;
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
}
