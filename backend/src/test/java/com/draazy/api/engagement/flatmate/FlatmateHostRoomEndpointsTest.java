package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// Room ownership tests focus on plausible regressions: host scoping and soft withdrawal.
// The second is Withdrawing#aSplitRoomCannotBeWithdrawnAlone().
@DisplayName("Flatmates — a host's own rooms")
class FlatmateHostRoomEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    PropertyRepository properties;

    @Autowired
    EntityManager em;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String name) {
        return user(mobile, name, Roles.Wire.BUYER);
    }

    private User user(String mobile, String name, String role) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private static String roomBody(String locality, String society) {
        return """
                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                 "furnishing":"semi","locality":"%s","society":"%s","rentShare":15000,
                 "deposit":30000,"availableFrom":"2026-09-01","lookingFor":"any",
                 "foodPref":"any","photos":["https://cdn.example/1.jpg"],
                 "hostRole":"owner",
                 "note":"Sunny room, quiet building."}
                """.formatted(locality, society);
    }

    private String createRoom(User host, String locality, String society) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(roomBody(locality, society)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private String publishedRoom(User host, String locality, String society) throws Exception {
        String id = createRoom(host, locality, society);
        return moderateTo(id, "approved");
    }

    // The transaction still holds the stale entity after UPDATE;
    // clear it so routes read the database value, as production would.
    private String moderateTo(String id, String modStatus) {
        jdbc.update("update flatmate_rooms set mod_status = ? where id = ?::uuid", modStatus, id);
        em.clear();
        return id;
    }

    @Nested
    @DisplayName("GET /me/flatmate-rooms")
    class MyRooms {

        @Test
        @DisplayName("includes a room still waiting on moderation — the host is not a stranger")
        void includesAPendingRoom() throws Exception {
            User host = user("9840000001", "Host One");
            createRoom(host, "Baner", "Sai Radha A");

            mvc.perform(get(Routes.Flatmates.MY_ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content.length()").value(1))
                    .andExpect(jsonPath("$.content[0].modStatus").value("pending"))
                    .andExpect(jsonPath("$.content[0].locality").value("Baner"));

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in").param("locality", "Baner"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("a room Ops rejected is still visible to its author")
        void includesARejectedRoom() throws Exception {
            User host = user("9840000002", "Host Two");
            moderateTo(createRoom(host, "Aundh", "Palm Grove"), "removed");

            mvc.perform(get(Routes.Flatmates.MY_ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content.length()").value(1))
                    .andExpect(jsonPath("$.content[0].modStatus").value("removed"));
        }

        @Test
        @DisplayName("does not include anyone else's")
        void scopedToTheHost() throws Exception {
            User host = user("9840000003", "Host Three");
            User other = user("9840000004", "Host Four");
            createRoom(host, "Kothrud", "Green Acres");

            mvc.perform(get(Routes.Flatmates.MY_ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content.length()").value(0));
        }

        @Test
        @DisplayName("carries the fields the public card drops, the host's own number included")
        void carriesTheHostsOwnView() throws Exception {
            User host = user("9840000005", "Host Five");
            createRoom(host, "Wakad", "Sai Radha B");

            mvc.perform(get(Routes.Flatmates.MY_ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].ownerMobile").value("9840000005"))
                    .andExpect(jsonPath("$.content[0].owner").value("Host Five"))
                    .andExpect(jsonPath("$.content[0].seatsTotal").value(1))
                    .andExpect(jsonPath("$.content[0].seatsOpen").value(1))
                    .andExpect(jsonPath("$.content[0].type").value("flatmate"))
                    .andExpect(jsonPath("$.page").value(0))
                    .andExpect(jsonPath("$.totalElements").value(1));
        }

        @Test
        @DisplayName("a withdrawn room drops out — that state the host chose themselves")
        void withdrawnRoomsAreGone() throws Exception {
            User host = user("9840000006", "Host Six");
            String id = createRoom(host, "Hinjewadi", "Blue Ridge");

            mvc.perform(delete(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isNoContent());

            mvc.perform(get(Routes.Flatmates.MY_ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content.length()").value(0));
        }

        @Test
        @DisplayName("anonymous is refused — this is a caller-scoped read, not a feed")
        void anonymousRefused() throws Exception {
            mvc.perform(get(Routes.Flatmates.MY_ROOMS))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Nested
    @DisplayName("DELETE /flatmates/rooms/{id}")
    class Withdrawing {

        @Test
        @DisplayName("204, and the room leaves the public feed")
        void withdrawTakesItDown() throws Exception {
            User host = user("9840000010", "Host Ten");
            String id = publishedRoom(host, "Baner", "Sai Radha C");

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in").param("locality", "Baner"))
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));

            mvc.perform(delete(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isNoContent())
                    .andExpect(result -> assertThat(result.getResponse().getContentAsString())
                            .as("204 carries no body")
                            .isEmpty());

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in").param("locality", "Baner"))
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("soft, not hard — the row survives with a reason, as a removed group does")
        void withdrawIsAnArchive() throws Exception {
            User host = user("9840000011", "Host Eleven");
            String id = createRoom(host, "Kothrud", "Green Acres II");

            mvc.perform(delete(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isNoContent());

            // Host withdrawal must not look like Ops removal; moderation state
            // and audit trail still point at this row.
            assertThat(jdbc.queryForObject(
                    "select archived from flatmate_rooms where id = ?::uuid", Boolean.class, id))
                    .isTrue();
            assertThat(jdbc.queryForObject(
                    "select archive_reason from flatmate_rooms where id = ?::uuid", String.class, id))
                    .isEqualTo("withdrawn by the host");
            assertThat(jdbc.queryForObject(
                    "select mod_status from flatmate_rooms where id = ?::uuid", String.class, id))
                    .isEqualTo("pending");
        }

        @Test
        @DisplayName("withdrawing frees the anti-broker cap slot")
        void withdrawFreesTheCapSlot() throws Exception {
            User host = user("9840000012", "Host Twelve");
            createRoom(host, "Aundh", "Cap One");
            createRoom(host, "Aundh", "Cap Two");
            String third = createRoom(host, "Aundh", "Cap Three");

            mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(roomBody("Aundh", "Cap Four")))
                    .andExpect(status().isConflict());

            mvc.perform(delete(Routes.Flatmates.ROOM_BY_ID, third)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isNoContent());

            mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(roomBody("Aundh", "Cap Four")))
                    .andExpect(status().isCreated());
        }

        @Test
        @DisplayName("someone else's room is a 403 — a room id is public, so nothing leaks")
        void strangerRefused() throws Exception {
            User host = user("9840000013", "Host Thirteen");
            User stranger = user("9840000014", "Stranger");
            String id = createRoom(host, "Wakad", "Not Yours");

            mvc.perform(delete(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                    .andExpect(status().isForbidden());

            assertThat(jdbc.queryForObject(
                    "select archived from flatmate_rooms where id = ?::uuid", Boolean.class, id))
                    .isFalse();
        }

        @Test
        @DisplayName("withdrawing twice is a 404 — the second press has nothing to act on")
        void secondWithdrawIsNotFound() throws Exception {
            User host = user("9840000015", "Host Fifteen");
            String id = createRoom(host, "Baner", "Twice Over");

            mvc.perform(delete(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isNoContent());

            mvc.perform(delete(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("an unknown id is a 404")
        void unknownRoomIsNotFound() throws Exception {
            User host = user("9840000016", "Host Sixteen");

            mvc.perform(delete(Routes.Flatmates.ROOM_BY_ID, UUID.randomUUID())
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("anonymous is refused")
        void anonymousRefused() throws Exception {
            User host = user("9840000017", "Host Seventeen");
            String id = createRoom(host, "Baner", "Anon Guard");

            mvc.perform(delete(Routes.Flatmates.ROOM_BY_ID, id))
                    .andExpect(status().isUnauthorized());
        }

        // Split-room occupants are the only move-in record, so sibling withdrawal
        // must not bypass the split delete guard.
        @Test
        @DisplayName("a split room cannot be withdrawn on its own")
        void aSplitRoomCannotBeWithdrawnAlone() throws Exception {
            User owner = user("9840000018", "Split Owner", Roles.Wire.OWNER);
            Property flat = new Property(owner, "Flat in Baner", "rent", "apartment",
                    45000L, "Baner", "Pune");
            flat.setBhk(BigDecimal.valueOf(2));
            flat.setStatus(PropertyStatus.APPROVED);
            Property saved = properties.saveAndFlush(flat);

            String json = mvc.perform(post(Routes.Properties.SPLIT, saved.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"maxOccupants\":4,\"rooms\":["
                                    + "{\"roomKind\":\"master\",\"rent\":15000},"
                                    + "{\"roomKind\":\"bedroom\",\"rent\":15000}]}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            String roomId = json.replaceAll(".*?\"rooms\"\\s*:\\s*\\[\\s*\\{.*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");

            mvc.perform(delete(Routes.Flatmates.ROOM_BY_ID, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message", Matchers.containsString("split_room")));

            assertThat(jdbc.queryForObject(
                    "select archived from flatmate_rooms where id = ?::uuid", Boolean.class, roomId))
                    .isFalse();
        }
    }
}
