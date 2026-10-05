package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

// The society FK is nullable because rooms may be offered in uncatalogued buildings.
// The FK cannot catch this: `null` is a legal value for the column.
@DisplayName("Flatmates — a room's society id has to name a society")
class FlatmateRoomSocietyTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private User host(String mobile) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName("Host " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    // This helper sends `societyId`; the shared supply helper deliberately never does.
    private static String roomBody(String societyId) {
        return """
                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                 "furnishing":"semi","locality":"Baner","societyId":%s,"rentShare":15000,
                 "deposit":30000,"availableFrom":"2026-09-01","lookingFor":"any",
                 "foodPref":"any","photos":["https://cdn.example/1.jpg"],
                 "hostRole":"owner","note":"Sunny room, quiet building."}
                """.formatted(societyId == null ? "null" : "\"" + societyId + "\"");
    }

    private ResultActions offerRoom(User host, String societyId) throws Exception {
        return mvc.perform(post(Routes.Flatmates.ROOMS)
                .header(HttpHeaders.AUTHORIZATION, bearer(host))
                .contentType(MediaType.APPLICATION_JSON)
                .content(roomBody(societyId)));
    }

    @Test
    @DisplayName("an unparseable society id is refused, not quietly discarded")
    void malformedSocietyIdIsRefused() throws Exception {
        offerRoom(host("9811100001"), "skyline-heights-baner")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("societyId is not a valid id"));

        assertThat(jdbc.queryForObject(
                "select count(*) from flatmate_rooms where locality = 'Baner' and society_id is null",
                Integer.class))
                .as("a refused request must not leave a society-less room behind")
                .isZero();
    }

    @Test
    @DisplayName("a well-formed id that names no society is a 404, not a 409")
    void unknownSocietyIdIsNotFound() throws Exception {
        offerRoom(host("9811100002"), UUID.randomUUID().toString())
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Society not found"));
    }

    @Test
    @DisplayName("omitting the society id is still allowed — the room just names no building")
    void absentSocietyIdStillWorks() throws Exception {
        // The guard must not turn an optional field into a required one.
        offerRoom(host("9811100003"), null)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.societyId").doesNotExist());
    }
}
