package com.draazy.api.engagement;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * {@code PATCH /me/saved-searches/{id}} — the update path saved-search alerts shipped without.
 *
 * <p>Alerts were a complete consumer feature with create and delete and nothing in between, so the
 * toggle the UI renders had nowhere to send its change. The frontend mock has carried a
 * {@code toggleSearchAlert} operation the whole time; this is the backend catching up to it.
 */
@DisplayName("Saved searches — alert preferences are editable")
class SavedSearchUpdateTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private User seeker(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Alert Watcher");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String createSearch(User u) throws Exception {
        String body = mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"2BHK Baner\",\"query\":\"2bhk baner\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.alertFrequency").value("daily"))
                .andReturn().getResponse().getContentAsString();
        return body.replaceAll("(?s).*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    @Test
    @DisplayName("frequency and channel can both be changed")
    void preferencesAreUpdatable() throws Exception {
        User u = seeker("9820000001");
        String id = createSearch(u);

        mvc.perform(patch("/me/saved-searches/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"alertFrequency\":\"weekly\",\"channel\":\"email\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alertFrequency").value("weekly"))
                .andExpect(jsonPath("$.channel").value("email"));
    }

    /**
     * The gesture the UI actually needs. {@code off} is a value in the vocabulary rather than a
     * null, which is why this record does not need the absent-vs-null distinction that tech-debt
     * D46 records as missing on {@code TicketUpdate}.
     */
    @Test
    @DisplayName("turning alerts off is a value, not an absence")
    void alertsCanBeTurnedOff() throws Exception {
        User u = seeker("9820000002");
        String id = createSearch(u);

        mvc.perform(patch("/me/saved-searches/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"alertFrequency\":\"off\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alertFrequency").value("off"))
                // Omitted fields are left alone rather than reset to their defaults.
                .andExpect(jsonPath("$.channel").value("whatsapp"));
    }

    @Test
    @DisplayName("an unknown frequency is a 422, not a 500 from the CHECK constraint")
    void unknownFrequencyIsRejectedAtTheEdge() throws Exception {
        User u = seeker("9820000003");
        String id = createSearch(u);

        mvc.perform(patch("/me/saved-searches/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"alertFrequency\":\"hourly\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    /**
     * User-scoping, asserted as 404 rather than 403. Telling a caller "that exists but is not
     * yours" is itself a disclosure — it confirms the id is real.
     */
    @Test
    @DisplayName("another user's saved search is 404, never 403")
    void crossUserUpdateIsNotFound() throws Exception {
        User owner = seeker("9820000004");
        User stranger = seeker("9820000005");
        String id = createSearch(owner);

        mvc.perform(patch("/me/saved-searches/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"alertFrequency\":\"off\"}"))
                .andExpect(status().isNotFound());

        // And the owner's row is untouched by the attempt.
        mvc.perform(get("/me/saved-searches").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].alertFrequency").value("daily"));
    }
}
