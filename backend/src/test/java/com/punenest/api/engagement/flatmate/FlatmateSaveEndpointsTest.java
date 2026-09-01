package com.punenest.api.engagement.flatmate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
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

/**
 * {@code /me/flatmate-saves} — the flatmate shortlist, which until now had no server at all.
 *
 * <p>It lived in {@code puneNestFlatmateSaved}: a localStorage map holding both the keys and a copy
 * of each card's title, price and photo, taken at save time. Two consequences this class exists to
 * close. A save belonged to a <em>browser</em>, so shortlisting a room on a phone left the laptop
 * showing an empty Saved page — and the copied card never refreshed, so a room whose rent changed
 * went on advertising the old number from inside the user's own shortlist.
 *
 * <p>The tests below are therefore about three things and not about bookmarking as such: that a save
 * is scoped to the <em>person</em>, that the card is rebuilt on read rather than stored, and that a
 * key pointing at nothing cannot be created (there is no FK to catch it — {@code post_id} may name
 * any of three tables).
 */
@DisplayName("Flatmates — the shortlist, and what it is allowed to point at")
class FlatmateSaveEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    /** Audit writes run {@code REQUIRES_NEW} and escape this test's rollback. */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeRowsThatEscapedRollback() {
        createdActors.forEach(actor -> {
            jdbc.update("delete from audit_log where actor = ?", actor);
            jdbc.update("delete from flatmate_saves where user_id = ?::uuid", actor);
        });
        createdActors.clear();
    }

    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private static String idOf(String json) {
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private String createRoom(User host, String society) throws Exception {
        String body = """
                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                 "furnishing":"semi","locality":"Baner","society":"%s","rentShare":15000,
                 "deposit":30000,"availableFrom":"2026-09-01","lookingFor":"any",
                 "foodPref":"any","photos":["https://cdn.example/1.jpg"]}
                """.formatted(society);
        String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return idOf(json);
    }

    private String createGroup(User host, String title) throws Exception {
        String body = """
                {"title":"%s","locality":"Baner","policy":"women","rent":40000,
                 "seats":3,"seatsOpen":1,"name":"Host"}
                """.formatted(title);
        String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return idOf(json);
    }

    private String createPost(User author, String name) throws Exception {
        String body = """
                {"name":"%s","gender":"female","age":26,"occupation":"UX Designer",
                 "budget":18000,"localities":["Baner"],"moveIn":"2026-09-01",
                 "flatPref":"women","roomPref":"private","tags":["Vegetarian"]}
                """.formatted(name);
        String json = mvc.perform(post(Routes.Flatmates.POSTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return idOf(json);
    }

    private String saveUrl(String kind, String id) {
        return Routes.Engagement.FLATMATE_SAVES + "/" + kind + "/" + id;
    }

    @Nested
    @DisplayName("saving")
    class Saving {

        @Test
        @DisplayName("shortlists a room, and answers with the card rather than the key")
        void savedRoomComesBackAsACard() throws Exception {
            User host = user("9840000001", "Host");
            User seeker = user("9840000002", "Seeker");
            String roomId = createRoom(host, "Zztest Heights");

            mvc.perform(put(saveUrl("room", roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isNoContent());

            /* The whole reason the shortlist moved off the device: the row that comes back is the
               same projection the feed renders, joined now, not a copy taken when the heart was
               tapped. A stored card could not carry `society` correctly the day the host edited it. */
            mvc.perform(get(Routes.Engagement.FLATMATE_SAVES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)))
                    .andExpect(jsonPath("$.content[0].id").value(roomId))
                    .andExpect(jsonPath("$.content[0].society").value("Zztest Heights"))
                    .andExpect(jsonPath("$.content[0].budget").value(15000))
                    // A shortlist is a browsing aid, not an introduction: the card is the anonymous one.
                    .andExpect(jsonPath("$.content[0].ownerMobile").doesNotExist());
        }

        @Test
        @DisplayName("holds all three kinds at once, newest save first")
        void shortlistIsHeterogeneousAndOrdered() throws Exception {
            User host = user("9840000003", "Host");
            User seeker = user("9840000004", "Seeker");
            String roomId = createRoom(host, "Zztest Heights");
            String groupId = createGroup(host, "Zztest three in Baner");
            String postId = createPost(host, "Zztest Seeker");

            for (String[] save : new String[][] {
                    { "room", roomId }, { "group", groupId }, { "post", postId } }) {
                mvc.perform(put(saveUrl(save[0], save[1]))
                                .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                        .andExpect(status().isNoContent());
            }

            /* Newest first, so the post saved last leads. Asserted because the alternative — insert
               order, or whatever the planner felt like — is what makes a shortlist reshuffle itself
               between visits for no reason the user can see. */
            mvc.perform(get(Routes.Engagement.FLATMATE_SAVES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalElements").value(3))
                    .andExpect(jsonPath("$.content[0].id").value(postId))
                    .andExpect(jsonPath("$.content[1].id").value(groupId))
                    .andExpect(jsonPath("$.content[2].id").value(roomId));
        }

        @Test
        @DisplayName("is idempotent — a second tap is not a second row")
        void savingTwiceLeavesOneRow() throws Exception {
            User host = user("9840000005", "Host");
            User seeker = user("9840000006", "Seeker");
            String roomId = createRoom(host, "Zztest Heights");

            mvc.perform(put(saveUrl("room", roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isNoContent());
            mvc.perform(put(saveUrl("room", roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isNoContent());

            mvc.perform(get(Routes.Engagement.FLATMATE_SAVES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(jsonPath("$.totalElements").value(1));
        }

        @Test
        @DisplayName("refuses a key that points at nothing")
        void unknownTargetIs404() throws Exception {
            User seeker = user("9840000007", "Seeker");

            /* There is no foreign key to catch this — `post_id` may name any of three tables, and
               Postgres has no polymorphic reference. Without the service's existence check a typo
               would be stored happily and reappear forever as a row that renders nothing. */
            mvc.perform(put(saveUrl("room", UUID.randomUUID().toString()))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("refuses a kind that is not one of the three tables")
        void unknownKindIs400() throws Exception {
            User seeker = user("9840000008", "Seeker");

            mvc.perform(put(saveUrl("listing", UUID.randomUUID().toString()))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isBadRequest());
        }

        @Test
        @DisplayName("needs a caller — an anonymous shortlist belongs to nobody")
        void anonymousIsRejected() throws Exception {
            mvc.perform(get(Routes.Engagement.FLATMATE_SAVES))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Nested
    @DisplayName("reading it back")
    class Reading {

        @Test
        @DisplayName("is scoped to the person, not the device — and not to anyone else")
        void oneUsersShortlistIsNotAnothers() throws Exception {
            User host = user("9840000009", "Host");
            User mine = user("9840000010", "Mine");
            User theirs = user("9840000011", "Theirs");
            String roomId = createRoom(host, "Zztest Heights");

            mvc.perform(put(saveUrl("room", roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(mine)))
                    .andExpect(status().isNoContent());

            /* The claim the localStorage version could not make at all: a save is a fact about a
               person. It follows them onto a second device, and it does not follow anyone else. */
            mvc.perform(get(Routes.Engagement.FLATMATE_SAVES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(mine)))
                    .andExpect(jsonPath("$.totalElements").value(1));
            mvc.perform(get(Routes.Engagement.FLATMATE_SAVES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(theirs)))
                    .andExpect(jsonPath("$.totalElements").value(0));
        }

        @Test
        @DisplayName("answers the board with keys rather than cards")
        void keysRouteReturnsKindAndId() throws Exception {
            User host = user("9840000012", "Host");
            User seeker = user("9840000013", "Seeker");
            String roomId = createRoom(host, "Zztest Heights");

            mvc.perform(put(saveUrl("room", roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isNoContent());

            mvc.perform(get(Routes.Engagement.FLATMATE_SAVE_KEYS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$", Matchers.hasSize(1)))
                    .andExpect(jsonPath("$[0].kind").value("room"))
                    .andExpect(jsonPath("$[0].id").value(roomId))
                    // Keys, deliberately: the board is already holding the card.
                    .andExpect(jsonPath("$[0].society").doesNotExist());
        }

        @Test
        @DisplayName("drops a save whose target has been deleted, and still counts the row")
        void deletedTargetLeavesAHoleInTheCountOnly() throws Exception {
            User host = user("9840000014", "Host");
            User seeker = user("9840000015", "Seeker");
            String kept = createRoom(host, "Zztest Kept");
            String doomed = createRoom(host, "Zztest Doomed");

            for (String id : List.of(kept, doomed)) {
                mvc.perform(put(saveUrl("room", id))
                                .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                        .andExpect(status().isNoContent());
            }
            mvc.perform(delete(Routes.Flatmates.ROOM_BY_ID, doomed)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isNoContent());

            /* A withdrawn room is gone rather than rendered as an empty card — the same contract
               `SavedPropertyService` states for a hard-deleted property, and for the same reason: a
               page with holes in it is worse than a page that is one row shorter. */
            mvc.perform(get(Routes.Engagement.FLATMATE_SAVES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)))
                    .andExpect(jsonPath("$.content[0].id").value(kept));
        }
    }

    @Nested
    @DisplayName("removing")
    class Removing {

        @Test
        @DisplayName("takes it off the shortlist, and says 204 whether or not it was there")
        void unsaveIsIdempotent() throws Exception {
            User host = user("9840000016", "Host");
            User seeker = user("9840000017", "Seeker");
            String roomId = createRoom(host, "Zztest Heights");

            mvc.perform(put(saveUrl("room", roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isNoContent());
            mvc.perform(delete(saveUrl("room", roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isNoContent());
            // Again: a repeat tap on an already-empty bookmark is not an error.
            mvc.perform(delete(saveUrl("room", roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isNoContent());

            mvc.perform(get(Routes.Engagement.FLATMATE_SAVES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(jsonPath("$.totalElements").value(0));
        }

        @Test
        @DisplayName("removes only the kind named, not every save with that id")
        void kindIsPartOfTheKey() throws Exception {
            User host = user("9840000018", "Host");
            User seeker = user("9840000019", "Seeker");
            String roomId = createRoom(host, "Zztest Heights");
            String groupId = createGroup(host, "Zztest three in Baner");

            mvc.perform(put(saveUrl("room", roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)));
            mvc.perform(put(saveUrl("group", groupId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)));
            mvc.perform(delete(saveUrl("room", roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isNoContent());

            mvc.perform(get(Routes.Engagement.FLATMATE_SAVE_KEYS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(jsonPath("$", Matchers.hasSize(1)))
                    .andExpect(jsonPath("$[0].kind").value("group"));
        }
    }
}
