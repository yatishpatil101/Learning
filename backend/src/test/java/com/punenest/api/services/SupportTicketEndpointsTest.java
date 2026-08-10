package com.punenest.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.security.Teams;
import com.punenest.api.services.support.AdminSupportTicketDto;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * The customer-facing support thread, and the ops queue over it.
 *
 * <p>Three properties carry this suite. <strong>The list at {@code GET /support/tickets} is the
 * caller's own</strong>, for staff and admin as well — spec fix S47, and the reason is that "every
 * support conversation on the platform" in one unpaged array is a PII export, not a feature.
 * <strong>The read model has two sides</strong> (D50): each is set by the other party writing and
 * cleared only by its own party reading, so neither can mark the other as caught up. And
 * <strong>the platform-wide view is a different operation</strong> (D51) — paged, staff/admin only,
 * summaries rather than threads.
 */
@DisplayName("Slice 12 — support tickets: the customer's thread with the platform")
class SupportTicketEndpointsTest extends ServiceFixtures {

    /** Distinctive enough that a substring search for it is a real leak check. */
    private static final String SECRET = "the card was declined three times";

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

    /**
     * Debt D50 — the second column, and the only thing that makes the queue below a queue.
     *
     * <p>The old arrangement was not wrong so much as half-built: one boolean has to mean one thing,
     * and what it meant was the customer's side. A staff member could read and answer any ticket and
     * had no way to see which ones were waiting on them. The assertions here are all about the
     * <em>independence</em> of the two signals, because that is the property a single overloaded
     * column cannot have and the one a careless merge would quietly destroy — a shared flag still
     * passes every "reply sets unread" test, and fails only when both sides are in play at once.
     */
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
            expectUnread(asha, id, true);
            // Answering does not put the ticket back on your own queue.
            expectAwaitingReply(desk, id, false);

            markRead(asha, id);
            replyTicket(asha, id, "any update?", 201);
            expectAwaitingReply(desk, id, true);
            // ...nor does it give the writer something new to read.
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
            // Both sides have something outstanding — the state one boolean cannot represent.
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

    /**
     * Debt D51 — the platform-wide list S47 removed and nothing replaced.
     *
     * <p>S47 was right to narrow {@code GET /support/tickets} to the caller's own tickets: one
     * operation cannot be a bare array for a customer and a page envelope for an admin. What it left
     * behind was an ops team that could answer any ticket and find none. The tests that matter here
     * are the two failure modes of "just add the list back": that it is genuinely paged rather than
     * an array with a page-shaped wrapper, and that it is a summary rather than every message body
     * on the platform in one response.
     */
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

            // 403 rather than a filtered-to-nothing 200: the caller is asking for a surface that is
            // not theirs, not for rows that happen not to exist.
            queue(asha).andExpect(status().isForbidden());
            mvc.perform(get(Routes.Admin.SUPPORT_TICKETS)).andExpect(status().isUnauthorized());
        }

        @Test
        @DisplayName("it is genuinely paged — never the whole platform in one array")
        void paged() throws Exception {
            User asha = customer("9840000144");
            User desk = staff("9840000145", Teams.RENTAL);
            raiseTicket(asha, "First");
            raiseTicket(asha, "Second");
            raiseTicket(asha, "Third");

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

            // The order is fixed server-side, so an unknown property here would otherwise be a 500
            // any caller can trigger with a guess (api-standards.md §5).
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

            // Omitted is the archive, not a synonym for either.
            queue(desk).andExpect(jsonPath("$.content", hasSize(2)));
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

            // Absent, not empty: the thread is read one ticket at a time at GET /support/tickets/{id},
            // and a page of twenty threads is the unbounded response the page envelope was meant to
            // prevent. The ops board's private `notes` has no counterpart here at all.
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

    /**
     * The desk's side, read where it is actually published — the ops queue.
     *
     * <p>Deliberately not asserted against the entity or the customer's {@code SupportTicket}: the
     * point of D50 is that the desk has a signal <em>it can see</em>, and a test that reads the
     * column directly would still pass on the day nothing exposed it.
     */
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

    private void markRead(User caller, String id) throws Exception {
        mvc.perform(post(Routes.SupportTickets.READ, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isNoContent());
    }
}
