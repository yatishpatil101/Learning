package com.draazy.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.services.support.AdminSupportTicketDto;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("Slice 12 — support tickets: the customer's thread with the platform")
class SupportTicketEndpointsTest extends ServiceFixtures {

    @org.springframework.beans.factory.annotation.Autowired
    EntityManager em;

    /** Distinctive enough that a substring search for it is a real leak check. */
    private static final String SECRET = "the card was declined three times";

    // The assertions here are about the independence of the two unread signals, which a single shared column cannot
    // provide.
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

            expectUnread(asha, id, false);

            replyTicket(desk, id, "we are looking into it", 201);
            expectUnread(asha, id, true);

            mvc.perform(post(Routes.SupportTickets.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(asha)))
                    .andExpect(status().isNoContent());
            expectUnread(asha, id, false);

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

            expectUnread(asha, id, true);
        }
    }

    @Nested
    @DisplayName("the two-sided read model (D50)")
    class TwoSided {

        @Test
        @DisplayName("a new ticket is already waiting on the desk — the opening message counts")
        void raisingPutsItOnTheQueue() throws Exception {
            User asha = customer("9840000131");
            User desk = staff("9840000132", Teams.RENTAL);
            String id = raiseTicket(asha, "Cannot log in");

            // A queue that only counted replies would show an empty board on a day full of new
            // tickets — the first message is the one nobody has answered.
            expectAwaitingReply(desk, id, true);
            expectUnread(asha, id, false);
        }

        @Test
        @DisplayName("a customer reply marks it unread for staff; a staff reply, for the raiser")
        void eachReplyMarksTheOtherSide() throws Exception {
            User asha = customer("9840000133");
            User desk = staff("9840000134", Teams.RENTAL);
            String id = raiseTicket(asha, "Refund status");

            mvc.perform(post(Routes.SupportTickets.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isNoContent());
            expectAwaitingReply(desk, id, false);

            replyTicket(desk, id, "processing it", 201);
            // Both sides have something outstanding — the state one boolean cannot represent.
            expectUnread(asha, id, true);

            expectAwaitingReply(desk, id, false);

            markRead(asha, id);
            replyTicket(asha, id, "any update?", 201);
            expectAwaitingReply(desk, id, true);

            expectUnread(asha, id, false);
        }

        @Test
        @DisplayName("reading one side leaves the other exactly as it was")
        void readsDoNotCross() throws Exception {
            User asha = customer("9840000135");
            User desk = staff("9840000136", Teams.RENTAL);
            String id = raiseTicket(asha, "Two things at once");

            replyTicket(desk, id, "we are on it", 201);
            replyTicket(asha, id, "thanks, one more thing", 201);

            expectUnread(asha, id, true);
            expectAwaitingReply(desk, id, true);

            markRead(desk, id);
            expectAwaitingReply(desk, id, false);
            expectUnread(asha, id, true);

            markRead(asha, id);
            expectUnread(asha, id, false);
            expectAwaitingReply(desk, id, false);
        }
    }

    // `GET /support/tickets` stays the caller's own; this paged summary queue is how staff find every ticket without
    // every message body.
    @Nested
    @DisplayName("the ops queue (D51)")
    class OpsQueue {

        @Test
        @DisplayName("staff and admin may read it; a customer may not")
        void authorised() throws Exception {
            User asha = customer("9840000141");
            User desk = staff("9840000142", Teams.RENTAL);
            User boss = admin("9840000143");
            raiseTicket(asha, "Who can see this");

            queue(desk).andExpect(status().isOk()).andExpect(jsonPath("$.content", hasSize(1)));
            queue(boss).andExpect(status().isOk()).andExpect(jsonPath("$.content", hasSize(1)));

            queue(asha).andExpect(status().isForbidden());
            mvc.perform(get(Routes.Admin.SUPPORT_TICKETS)).andExpect(status().isUnauthorized());
        }

        @Test
        @DisplayName("a scoped staff account needs the support function")
        void supportFunctionRequired() throws Exception {
            User asha = customer("9840000151");
            User desk = scopedStaff("9840000152", "[]");
            String id = raiseTicket(asha, "Permission probe");

            queue(desk).andExpect(status().isForbidden());
            mvc.perform(get(Routes.SupportTickets.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isForbidden());
            replyTicket(desk, id, "looking", 403);
            mvc.perform(post(Routes.SupportTickets.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("it is genuinely paged — never the whole platform in one array")
        void paged() throws Exception {
            User asha = customer("9840000144");
            User desk = staff("9840000145", Teams.RENTAL);
            raiseTicket(asha, "First");
            raiseTicket(asha, "Second");
            raiseTicket(asha, "Third");

            // The order is fixed server-side, so an unknown property here would otherwise be a 500
            // any caller can trigger with a guess (api-standards.md §5).
            mvc.perform(get(Routes.Admin.SUPPORT_TICKETS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .param("size", "2"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(2)))
                    .andExpect(jsonPath("$.page").value(0))
                    .andExpect(jsonPath("$.size").value(2))
                    .andExpect(jsonPath("$.totalElements").value(3))
                    .andExpect(jsonPath("$.totalPages").value(2));

            mvc.perform(get(Routes.Admin.SUPPORT_TICKETS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .param("size", "2")
                            .param("page", "1"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)));
        }

        @Test
        @DisplayName("a client-supplied sort cannot reach the query")
        void sortIsStripped() throws Exception {
            User desk = staff("9840000146", Teams.RENTAL);

            mvc.perform(get(Routes.Admin.SUPPORT_TICKETS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .param("sort", "notAColumn,desc"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.sort").value(nullValue()));
        }

        @Test
        @DisplayName("awaitingReply narrows to the tickets actually waiting on the desk")
        void filtered() throws Exception {
            User asha = customer("9840000147");
            User desk = staff("9840000148", Teams.RENTAL);
            String answered = raiseTicket(asha, "Already handled");
            raiseTicket(asha, "Still waiting");
            markRead(desk, answered);

            mvc.perform(get(Routes.Admin.SUPPORT_TICKETS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .param("awaitingReply", "true"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].subject").value("Still waiting"));

            mvc.perform(get(Routes.Admin.SUPPORT_TICKETS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .param("awaitingReply", "false"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].subject").value("Already handled"));

            queue(desk).andExpect(jsonPath("$.content", hasSize(2)));
            queue(desk).andExpect(jsonPath("$.counts.all").value(
                    org.hamcrest.Matchers.greaterThanOrEqualTo(2)));
        }

        @Test
        @DisplayName("counts split the whole table into awaiting and answered, whatever filter was asked for")
        void countsMoveWithTheDesk() throws Exception {
            User asha = customer("9840000157");
            User desk = staff("9840000158", Teams.RENTAL);
            long awaiting = countOf(desk, "awaiting");
            long answered = countOf(desk, "answered");
            String handled = raiseTicket(asha, "Handled soon");
            raiseTicket(asha, "Waiting still");
            markRead(desk, handled);

            mvc.perform(get(Routes.Admin.SUPPORT_TICKETS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .param("awaitingReply", "false").param("size", "1"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.counts.awaiting").value(awaiting + 1))
                    .andExpect(jsonPath("$.counts.answered").value(answered + 1))
                    .andExpect(jsonPath("$.counts.all").value(awaiting + answered + 2));
        }

        private long countOf(User desk, String key) throws Exception {
            String body = queue(desk).andReturn().getResponse().getContentAsString();
            return Long.parseLong(body.replaceAll("(?s).*\"counts\":\\{[^}]*\"" + key + "\":(\\d+).*", "$1"));
        }

        @Test
        @DisplayName("a queue row is a summary — no message bodies, and no notes field to fill")
        void rowsCarryNoThread() throws Exception {
            User asha = customer("9840000149");
            User desk = staff("9840000150", Teams.RENTAL);
            String id = raiseTicket(asha, "Distinctive subject");
            replyTicket(desk, id, SECRET, 201);

            String body = queue(desk)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].raiser").value("Asha Patil"))
                    .andReturn().getResponse().getContentAsString();

            // Absent, not empty: the thread is read one ticket at a time at GET /support/tickets/{id}, and a page of
            // twenty threads is the unbounded response the page envelope was meant to prevent.
            assertThat(body).doesNotContain(SECRET).doesNotContain("\"messages\"")
                    .doesNotContain("\"notes\"").doesNotContain("9840000149");
            assertThat(AdminSupportTicketDto.class.getRecordComponents())
                    .noneMatch(c -> "messages".equals(c.getName()) || "notes".equals(c.getName()));
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
            String id = raiseTicket(asha, "Question about plans");

            mvc.perform(post(Routes.SupportTickets.MESSAGES, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"Plans renew yearly.\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.body").value("Plans renew yearly."))
                    .andExpect(jsonPath("$.author").value("Rohit Desk"))
                    .andExpect(jsonPath("$.authorRole").value("staff"))
                    .andExpect(jsonPath("$.id").isNotEmpty());

            mvc.perform(get(Routes.SupportTickets.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(asha)))
                    .andExpect(jsonPath("$.messages", hasSize(2)))
                    .andExpect(jsonPath("$.messages[0].authorRole").value("buyer"));
        }

        @Test
        @DisplayName("a message whose author is gone still renders; it does not take the thread down")
        void authorlessMessageStillRenders() throws Exception {
            User asha = customer("9840000124");
            User desk = staff("9840000125", Teams.RENTAL);
            String id = raiseTicket(asha, "Receipt never arrived");
            replyTicket(desk, id, "Re-sending it now.", 201);

            // `author_id` is nullable, and the seed for the e2e database exercises exactly this row: a desk message
            // written by nobody in particular.
            jdbc.update("update support_ticket_messages set author_id = null where ticket_id = ? and author_role = 'staff'",
                    UUID.fromString(id));

            // The row is already managed; without this the read answers from the first-level cache
            // and the column change is invisible to the assertion below.
            em.flush();
            em.clear();

            mvc.perform(get(Routes.SupportTickets.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(asha)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.messages", hasSize(2)))
                    .andExpect(jsonPath("$.messages[1].authorId", nullValue()))
                    .andExpect(jsonPath("$.messages[1].author", nullValue()))
                    .andExpect(jsonPath("$.messages[1].authorRole").value("staff"))
                    .andExpect(jsonPath("$.messages[1].body").value("Re-sending it now."));
        }

        @Test
        @DisplayName("a ticket cannot be raised without a subject or a first message")
        void validation() throws Exception {
            User asha = customer("9840000123");

            raiseRaw(asha, "{\"subject\":\"\",\"body\":\"help\"}", 422);
            raiseRaw(asha, "{\"subject\":\"Help\"}", 422);
        }
    }

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

    private void expectAwaitingReply(User ops, String id, boolean expected) throws Exception {
        queue(ops)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id=='" + id + "')].awaitingReply",
                        contains(expected)));
    }

    private ResultActions queue(User caller) throws Exception {
        return mvc.perform(get(Routes.Admin.SUPPORT_TICKETS)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                .param("size", "100"));
    }

    private User scopedStaff(String mobile, String functionsJson) {
        User user = new User(mobile, Roles.Wire.STAFF);
        user.setName("Rohit Desk");
        user.setTeam(Teams.RENTAL);
        user.setMobileVerified(true);
        User saved = users.saveAndFlush(user);
        jdbc.update("INSERT INTO back_office_permissions (user_id, permissions) "
                + "VALUES (?::uuid, ?::jsonb)", saved.getId().toString(), functionsJson);
        return saved;
    }

    private void markRead(User caller, String id) throws Exception {
        mvc.perform(post(Routes.SupportTickets.READ, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isNoContent());
    }
}
