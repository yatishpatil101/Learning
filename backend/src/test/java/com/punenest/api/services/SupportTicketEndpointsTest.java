package com.punenest.api.services;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
 * The customer-facing support thread.
 *
 * <p>Two properties carry this suite. <strong>The list is the caller's own</strong>, for staff and
 * admin as well — spec fix S47, and the reason is that "every support conversation on the platform"
 * in one unpaged array is a PII export, not a feature. <strong>{@code unread} points one way</strong>:
 * it is the customer's signal that a reply is waiting, so ops answering sets it and the customer's
 * own reply does not.
 */
@DisplayName("Slice 12 — support tickets: the customer's thread with the platform")
class SupportTicketEndpointsTest extends ServiceFixtures {

    @Nested
    @DisplayName("scope")
    class Scope {

        @Test
        @DisplayName("the list is the caller's own — including for admin (S47)")
        void listIsAlwaysMine() throws Exception {
            User asha = customer("9840000101");
            User boss = admin("9840000102");
            raiseTicket(asha, "Refund not received");

            mvc.perform(get(Routes.SupportTickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(asha)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$", hasSize(1)))
                    .andExpect(jsonPath("$[0].subject").value("Refund not received"))
                    .andExpect(jsonPath("$[0].status").value("open"))
                    .andExpect(jsonPath("$[0].messages", hasSize(1)));

            // An admin reading this endpoint sees their own tickets, not the platform's. Ops triage
            // has its own paged, team-scoped board at GET /tickets.
            mvc.perform(get(Routes.SupportTickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(boss)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$", hasSize(0)));
        }

        @Test
        @DisplayName("ops may open and answer any ticket; another customer may not")
        void detailScope() throws Exception {
            User asha = customer("9840000103");
            User other = customer("9840000104");
            User desk = staff("9840000105", Teams.RENTAL);
            String id = raiseTicket(asha, "Cannot upload documents");

            mvc.perform(get(Routes.SupportTickets.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk());

            // 404, not 403 — a 403 would confirm the ticket exists.
            mvc.perform(get(Routes.SupportTickets.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                    .andExpect(status().isNotFound());
            replyTicket(other, id, "let me see", 404);
            mvc.perform(post(Routes.SupportTickets.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                    .andExpect(status().isNotFound());

            mvc.perform(get(Routes.SupportTickets.BY_ID, "not-a-uuid")
                            .header(HttpHeaders.AUTHORIZATION, bearer(asha)))
                    .andExpect(status().isNotFound());
        }
    }

    @Nested
    @DisplayName("the unread flag")
    class Unread {

        @Test
        @DisplayName("staff replying raises it; the customer's own reply does not; read clears it")
        void lifecycle() throws Exception {
            User asha = customer("9840000111");
            User desk = staff("9840000112", Teams.RENTAL);
            String id = raiseTicket(asha, "Payment failed");

            expectUnread(asha, id, false);

            replyTicket(asha, id, "any update?", 201);
            // Answering your own ticket gives you nothing new to read.
            expectUnread(asha, id, false);

            replyTicket(desk, id, "we are looking into it", 201);
            expectUnread(asha, id, true);

            mvc.perform(post(Routes.SupportTickets.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(asha)))
                    .andExpect(status().isNoContent());
            expectUnread(asha, id, false);

            // Idempotent — the client marks read every time it opens the ticket.
            mvc.perform(post(Routes.SupportTickets.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(asha)))
                    .andExpect(status().isNoContent());
            expectUnread(asha, id, false);
        }

        @Test
        @DisplayName("a staff read does not clear the customer's flag")
        void opsCannotReadOnTheCustomersBehalf() throws Exception {
            User asha = customer("9840000113");
            User desk = staff("9840000114", Teams.RENTAL);
            String id = raiseTicket(asha, "Wrong invoice");
            replyTicket(desk, id, "fixed", 201);

            mvc.perform(post(Routes.SupportTickets.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isNoContent());

            // Still unread. Clearing it here would tell Asha she had read a reply she has not seen.
            expectUnread(asha, id, true);
        }
    }

    @Nested
    @DisplayName("the thread")
    class Thread {

        @Test
        @DisplayName("the reply comes back as a message, not as a bare 201 (S46)")
        void replyIsRendered() throws Exception {
            User asha = customer("9840000121");
            User desk = staff("9840000122", Teams.RENTAL);
            String id = raiseTicket(asha, "Question about boost");

            mvc.perform(post(Routes.SupportTickets.MESSAGES, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"Boosts run for seven days.\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.body").value("Boosts run for seven days."))
                    .andExpect(jsonPath("$.author").value("Rohit Desk"))
                    .andExpect(jsonPath("$.authorRole").value("staff"))
                    .andExpect(jsonPath("$.id").isNotEmpty());

            mvc.perform(get(Routes.SupportTickets.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(asha)))
                    .andExpect(jsonPath("$.messages", hasSize(2)))
                    .andExpect(jsonPath("$.messages[0].authorRole").value("buyer"));
        }

        @Test
        @DisplayName("a ticket cannot be raised without a subject or a first message")
        void validation() throws Exception {
            User asha = customer("9840000123");

            raiseRaw(asha, "{\"subject\":\"\",\"body\":\"help\"}", 422);
            raiseRaw(asha, "{\"subject\":\"Help\"}", 422);
        }
    }

    // --- fixtures -------------------------------------------------------------------------

    private String raiseTicket(User caller, String subject) throws Exception {
        String json = mvc.perform(post(Routes.SupportTickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"" + subject
                                + "\",\"category\":\"billing\",\"body\":\"Please help\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return field(json, "id");
    }

    private void raiseRaw(User caller, String body, int expected) throws Exception {
        mvc.perform(post(Routes.SupportTickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().is(expected));
    }

    private void replyTicket(User caller, String id, String text, int expected) throws Exception {
        mvc.perform(post(Routes.SupportTickets.MESSAGES, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"" + text + "\"}"))
                .andExpect(status().is(expected));
    }

    private void expectUnread(User caller, String id, boolean expected) throws Exception {
        mvc.perform(get(Routes.SupportTickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unread").value(expected));
    }
}
