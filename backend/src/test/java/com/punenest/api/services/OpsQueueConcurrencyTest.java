package com.punenest.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.security.Teams;
import com.punenest.api.services.ticket.Ticket;
import com.punenest.api.services.ticket.TicketRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Optimistic locking on the ops queues (tech debt D48).
 *
 * <p>The situation being defended against is mundane and used to be invisible: two staff members
 * open the same ticket, both change something, both press save. Before {@code @Version} the second
 * save overwrote the first, both callers saw {@code 200}, and the audit log recorded two successful
 * updates — so there was no artefact anywhere from which the lost edit could be recovered, or even
 * noticed.
 *
 * <p><strong>Why there are no threads here.</strong> A race reproduced with threads is a race
 * reproduced <em>sometimes</em>, and a flaky test guarding concurrency is worse than none. What
 * makes a lost update possible is not simultaneity but <strong>staleness</strong>: one writer
 * holding a copy of the row the database has since moved past. Staleness is deterministic.
 *
 * <p><strong>Why the {@code EntityManager} appears at all.</strong> Every test in this suite runs
 * inside one rolled-back transaction, so two HTTP requests share a persistence context and Hibernate
 * hands both of them the <em>same instance</em> — there is no second copy to go stale. Detaching one
 * copy is what restores the two-editors situation the production code actually meets, where the two
 * requests arrive on different connections. {@code flush()} stands in for the winner's commit.
 */
@DisplayName("Slice 11 — concurrent edits on the ops queues")
class OpsQueueConcurrencyTest extends ServiceFixtures {

    @Autowired
    TicketRepository tickets;

    @PersistenceContext
    EntityManager em;

    @Test
    @DisplayName("a stale write loses rather than silently overwriting the winner")
    void staleWriteIsRejected() throws Exception {
        User buyer = customer("9820000801");
        User legal = staff("9820000802", Teams.LEGAL);
        String id = create(buyer, "{\"subject\":\"Rent agreement\",\"team\":\"legal\"}", 201);

        // Staff A opens the ticket. Detached, so it is a genuine private copy from here on.
        Ticket stale = tickets.findById(UUID.fromString(id)).orElseThrow();
        em.detach(stale);

        // Staff B edits and saves first.
        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(legal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"priority\":\"high\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.priority").value("high"));
        em.flush();
        assertThat(version(id)).isEqualTo(1L);

        // Staff A now saves their copy. Without @Version this succeeds and B's change is gone.
        // Nothing may follow this assertion: a failed lock leaves the transaction rollback-only,
        // so the "B's edit survived" half of the claim is checked above, before the collision.
        stale.setStatus("closed");
        assertThatThrownBy(() -> tickets.saveAndFlush(stale))
                .isInstanceOf(OptimisticLockingFailureException.class);
    }

    @Test
    @DisplayName("the version column is real and moves on every update")
    void versionIncrementsPerUpdate() throws Exception {
        User buyer = customer("9820000803");
        User legal = staff("9820000804", Teams.LEGAL);
        String id = create(buyer, "{\"subject\":\"Site visit\",\"team\":\"legal\"}", 201);
        em.flush();

        assertThat(version(id)).isZero();

        patchTicket(legal, id, "{\"priority\":\"high\"}");
        assertThat(version(id)).isEqualTo(1L);

        patchTicket(legal, id, "{\"status\":\"in-progress\"}");
        assertThat(version(id)).isEqualTo(2L);
    }

    /**
     * Sequential edits by different people must still both land. Optimistic locking only rejects a
     * writer holding a stale copy, and every controller here reloads per request — so this is the
     * case that must <em>not</em> have regressed into a 409.
     */
    @Test
    @DisplayName("back-to-back edits by two people both succeed")
    void sequentialEditsBothLand() throws Exception {
        User buyer = customer("9820000805");
        User legal = staff("9820000806", Teams.LEGAL);
        User boss = admin("9820000807");
        String id = create(buyer, "{\"subject\":\"Agreement review\",\"team\":\"legal\"}", 201);

        patchTicket(legal, id, "{\"priority\":\"high\"}");
        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(boss))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"in-progress\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.priority").value("high"))
                .andExpect(jsonPath("$.status").value("in-progress"));
    }

    private void patchTicket(User caller, String id, String body) throws Exception {
        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
        em.flush();
    }

    /**
     * Read straight out of the table rather than through JPA: the claim is that the column exists in
     * the schema and that Hibernate maintains it, and asking Hibernate would only prove that
     * Hibernate agrees with itself.
     */
    private long version(String id) {
        return jdbc.queryForObject("select version from tickets where id = ?::uuid",
                Long.class, id);
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
}
