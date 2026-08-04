package com.punenest.api.services;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.security.Teams;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The ops ticket board.
 *
 * <p>Two properties carry this suite. First, <strong>anyone signed in can raise a ticket and only
 * ops can read the board</strong> — the same asymmetry as the abuse queue, and the reason
 * {@code POST /tickets} deliberately carries no {@code x-roles}. Second, <strong>team scoping fails
 * closed</strong>: a staff account with no desk sees nothing rather than everything, which is the
 * one case a "filter by my team" implementation gets wrong by accident.
 */
@DisplayName("Slice 11 — the ops ticket board")
class TicketQueueTest extends ServiceFixtures {

    @Nested
    @DisplayName("who may do what")
    class Access {

        @Test
        @DisplayName("a customer can raise a ticket but cannot read the board")
        void customersRaiseButDoNotRead() throws Exception {
            User buyer = customer("9820000301");

            create(buyer, "{\"subject\":\"Need a rent agreement\",\"team\":\"legal\"}", 201);
            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("the customer and mobile come off the token, never off the body")
        void identityIsServerResolved() throws Exception {
            User buyer = customer("9820000302");

            mvc.perform(post(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"subject\":\"Site visit\",\"team\":\"rental\","
                                    + "\"customer\":\"Someone Else\",\"mobile\":\"9000000000\","
                                    + "\"value\":99900000,\"status\":\"closed\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.customer").value("Asha Patil"))
                    .andExpect(jsonPath("$.mobile").value("9820000302"))
                    .andExpect(jsonPath("$.status").value("open"))
                    .andExpect(jsonPath("$.priority").value("medium"))
                    .andExpect(jsonPath("$.value").value(nullValue()));
        }

        @Test
        @DisplayName("an anonymous caller cannot raise one")
        void anonymousRejected() throws Exception {
            mvc.perform(post(Routes.Tickets.BASE)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"subject\":\"hello\"}"))
                    .andExpect(status().isUnauthorized());
        }

        @Test
        @DisplayName("a customer cannot work the board")
        void customersCannotWorkTheBoard() throws Exception {
            User buyer = customer("9820000303");
            String id = create(buyer, "{\"subject\":\"Need help\",\"team\":\"legal\"}", 201);

            mvc.perform(patch(Routes.Tickets.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"closed\"}"))
                    .andExpect(status().isForbidden());
            note(buyer, id, "closing this", 403);
        }
    }

    @Nested
    @DisplayName("team scoping")
    class Scoping {

        @Test
        @DisplayName("a staff member sees only their own desk")
        void staffSeeOneDesk() throws Exception {
            User buyer = customer("9820000304");
            create(buyer, "{\"subject\":\"Agreement\",\"team\":\"legal\"}", 201);
            create(buyer, "{\"subject\":\"Site visit\",\"team\":\"rental\"}", 201);
            User legal = staff("9820000305", Teams.LEGAL);

            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].team").value("legal"));
        }

        @Test
        @DisplayName("a staff account with no desk sees nothing — it fails closed")
        void desklessStaffSeeNothing() throws Exception {
            User buyer = customer("9820000306");
            create(buyer, "{\"subject\":\"Agreement\",\"team\":\"legal\"}", 201);
            User nobody = staff("9820000307", null);

            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(nobody)))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("an admin sees every desk, and can filter to one")
        void adminSeesEverything() throws Exception {
            User buyer = customer("9820000308");
            create(buyer, "{\"subject\":\"Agreement\",\"team\":\"legal\"}", 201);
            create(buyer, "{\"subject\":\"Site visit\",\"team\":\"rental\"}", 201);
            User boss = admin("9820000309");

            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(boss)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(2)));

            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(boss))
                            .param("team", "rental"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)));
        }

        @Test
        @DisplayName("asking for somebody else's desk is refused, not silently rewritten")
        void crossDeskFilterRefused() throws Exception {
            User legal = staff("9820000310", Teams.LEGAL);

            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal))
                            .param("team", "rental"))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("another desk's ticket cannot be worked")
        void crossDeskWriteRefused() throws Exception {
            User buyer = customer("9820000311");
            String id = create(buyer, "{\"subject\":\"Agreement\",\"team\":\"legal\"}", 201);
            User rental = staff("9820000312", Teams.RENTAL);

            mvc.perform(patch(Routes.Tickets.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(rental))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"closed\"}"))
                    .andExpect(status().isForbidden());
            note(rental, id, "mine now", 403);
        }

        @Test
        @DisplayName("an unknown team is a 400, not an empty board")
        void unknownTeamRejected() throws Exception {
            User boss = admin("9820000313");

            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(boss))
                            .param("team", "marketing"))
                    .andExpect(status().isBadRequest());
        }
    }

    @Nested
    @DisplayName("working a ticket")
    class Working {

        @Test
        @DisplayName("assignment is by user id and resolves to a display name")
        void assignmentByIdShowsAName() throws Exception {
            User buyer = customer("9820000314");
            String id = create(buyer, "{\"subject\":\"Agreement\",\"team\":\"legal\"}", 201);
            User legal = staff("9820000315", Teams.LEGAL);

            mvc.perform(patch(Routes.Tickets.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"assigneeId\":\"" + legal.getId() + "\","
                                    + "\"status\":\"in-progress\",\"priority\":\"high\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.assignee").value("Rohit Desk"))
                    .andExpect(jsonPath("$.status").value("in-progress"))
                    .andExpect(jsonPath("$.priority").value("high"));
        }

        @Test
        @DisplayName("work cannot be assigned to a customer")
        void cannotAssignToACustomer() throws Exception {
            User buyer = customer("9820000316");
            String id = create(buyer, "{\"subject\":\"Agreement\",\"team\":\"legal\"}", 201);
            User legal = staff("9820000317", Teams.LEGAL);

            mvc.perform(patch(Routes.Tickets.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"assigneeId\":\"" + buyer.getId() + "\"}"))
                    .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("an unknown status or priority is refused before it reaches the CHECK")
        void vocabularyIsValidated() throws Exception {
            User buyer = customer("9820000318");
            String id = create(buyer, "{\"subject\":\"Agreement\",\"team\":\"legal\"}", 201);
            User legal = staff("9820000319", Teams.LEGAL);

            patchTicket(legal, id, "{\"status\":\"escalated\"}", 400);
            patchTicket(legal, id, "{\"priority\":\"immediate\"}", 400);
            patchTicket(legal, id, "{\"team\":\"marketing\"}", 400);
        }

        @Test
        @DisplayName("re-teaming a ticket moves it out of the caller's own board")
        void reteamingMovesItAway() throws Exception {
            User buyer = customer("9820000320");
            String id = create(buyer, "{\"subject\":\"Agreement\",\"team\":\"legal\"}", 201);
            User legal = staff("9820000321", Teams.LEGAL);

            patchTicket(legal, id, "{\"team\":\"rental\"}", 200);
            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(0)));
        }

        @Test
        @DisplayName("notes are attributed to the caller and appended, never replaced")
        void notesAppend() throws Exception {
            User buyer = customer("9820000322");
            String id = create(buyer, "{\"subject\":\"Agreement\",\"team\":\"legal\"}", 201);
            User legal = staff("9820000323", Teams.LEGAL);

            note(legal, id, "called the owner", 201);
            note(legal, id, "owner will send the deed", 201);

            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].notes", hasSize(2)))
                    .andExpect(jsonPath("$.content[0].notes[0].by").value("Rohit Desk"))
                    .andExpect(jsonPath("$.content[0].notes[0].text").value("called the owner"));
        }

        @Test
        @DisplayName("an unknown ticket is a 404 even for an admin")
        void unknownTicket() throws Exception {
            User boss = admin("9820000324");

            patchTicket(boss, "not-a-uuid", "{\"status\":\"closed\"}", 404);
        }

        @Test
        @DisplayName("a client-supplied sort cannot reach the query")
        void sortIsStripped() throws Exception {
            User boss = admin("9820000325");

            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(boss))
                            .param("sort", "notAColumn,desc"))
                    .andExpect(status().isOk());
        }
    }

    private String create(User caller, String body, int expected) throws Exception {
        String json = mvc.perform(post(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().is(expected))
                .andReturn().getResponse().getContentAsString();
        return field(json, "id");
    }

    private void patchTicket(User caller, String id, String body, int expected) throws Exception {
        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().is(expected));
    }

    private void note(User caller, String id, String text, int expected) throws Exception {
        mvc.perform(post(Routes.Tickets.NOTES, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"" + text + "\"}"))
                .andExpect(status().is(expected));
    }
}
