package com.punenest.api.engagement;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * {@code POST /me/saved-searches} — the per-user count cap (open-questions Q4).
 *
 * <p>Each blob is already size-bounded; this asserts the other half — that a user cannot accumulate
 * saved searches without limit. The tenth create succeeds and the eleventh is a {@code 409}, a
 * well-formed request that conflicts only with the caller's own current state.
 */
@DisplayName("Saved searches — count is capped per user")
class SavedSearchCapTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private static final int MAX = 10;

    private User seeker(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Alert Watcher");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private void createSearch(User u, int n) throws Exception {
        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"search " + n + "\",\"query\":\"q" + n + "\"}"))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("the eleventh saved search is a 409, and the cap is per-user not global")
    void eleventhIsRejected() throws Exception {
        User u = seeker("9820001001");
        for (int n = 1; n <= MAX; n++) {
            createSearch(u, n);
        }

        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"one too many\",\"query\":\"overflow\"}"))
                .andExpect(status().isConflict());

        // The cap counts only this user's rows, so a different user still starts from zero.
        User other = seeker("9820001002");
        createSearch(other, 1);
        mvc.perform(get("/me/saved-searches").header(HttpHeaders.AUTHORIZATION, bearer(other)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    @DisplayName("deleting one frees a slot, so the cap is a ceiling not a lifetime quota")
    void deletingFreesASlot() throws Exception {
        User u = seeker("9820001003");
        String firstId = null;
        for (int n = 1; n <= MAX; n++) {
            String body = mvc.perform(post("/me/saved-searches")
                            .header(HttpHeaders.AUTHORIZATION, bearer(u))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"name\":\"search " + n + "\",\"query\":\"q" + n + "\"}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            if (n == 1) {
                firstId = body.replaceAll("(?s).*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
            }
        }

        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/me/saved-searches/" + firstId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());

        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"back to ten\",\"query\":\"refill\"}"))
                .andExpect(status().isCreated());
    }
}
