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

/**
 * What {@code POST /flatmates/rooms} does with a {@code societyId} that is not a society.
 *
 * <p>The column is a nullable plain FK — a room may legitimately name no society, because people
 * offer rooms in buildings the catalogue has never heard of. That optionality is what let two
 * different failures through, and the worse of the two was the quiet one.
 *
 * <ol>
 *   <li><strong>A malformed id was silently dropped.</strong> {@code FlatmateMapper} binds this
 *       field through {@code uuidOrNull}, so anything unparseable — a slug sent where an id
 *       belongs, a truncated paste — became {@code null}. The room was created, {@code 201}, with
 *       no society, and the host was told it worked. Their room never reaches the society's hub and
 *       no record anywhere says they asked for one. The FK cannot catch this: {@code null} is a
 *       legal value for the column.</li>
 *   <li><strong>A well-formed id naming nothing became a 409.</strong> It reached the flush, hit
 *       {@code flatmate_rooms_society_id_fkey}, and came back as "That request conflicts with
 *       existing data" — a conflict message naming no field, for a request that conflicts with
 *       nothing.</li>
 * </ol>
 *
 * <p>The 404 in the second case is chosen to match {@code ListingEditRules.requireSociety} (D218)
 * rather than invented here. Two endpoints that both accept a society id should not disagree about
 * what a stale one means, and a test that pins the status is the only thing that keeps them
 * agreeing once the two are edited by different people months apart.
 */
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

    /**
     * A room body with an explicit {@code societyId}, which the shared helper in
     * {@link FlatmateSupplyEndpointsTest} deliberately never sends.
     */
    private static String roomBody(String societyId) {
        return """
                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                 "furnishing":"semi","locality":"Baner","societyId":%s,"rentShare":15000,
                 "deposit":30000,"availableFrom":"2026-09-01","lookingFor":"any",
                 "foodPref":"any","photos":["https://cdn.example/1.jpg"],
                 "note":"Sunny room, quiet building."}
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

        // The point of the test: nothing was written. Before the guard this was a 201 and a row.
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
        /* The guard must not turn an optional field into a required one. A room offered in a
           building the catalogue has never heard of is the ordinary case, not an edge case. */
        offerRoom(host("9811100003"), null)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.societyId").doesNotExist());
    }
}
