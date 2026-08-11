package com.punenest.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.security.Roles;
import com.punenest.api.security.Teams;
import com.punenest.api.services.ticket.Ticket;
import com.punenest.api.services.ticket.TicketRepository;
import com.punenest.api.services.ticket.TicketUpdate;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Debt D46 — handing a ticket back to the pool.
 *
 * <p>The defect this closes is not "unassign does not work", it is that unassign had no spelling at
 * all: a record turns both an absent {@code assigneeId} and an explicit JSON {@code null} into the
 * same {@code null} component, and the platform reads that as "leave it". So the two assertions that
 * matter are a pair, and neither is worth much alone — that omission still leaves the assignee
 * standing, and that the reserved word actually clears it. A suite that only asserted the second
 * would pass just as happily on an implementation that wiped the assignee on every PATCH.
 *
 * <p>The third test is the boundary. A sentinel is a licence to accept one magic string, not a
 * licence to stop validating: a mistyped id must keep failing loudly rather than degrading into an
 * unassignment, which would be a silent data loss dressed up as a feature.
 */
@DisplayName("Debt D46 — a ticket can be handed back to the pool")
class TicketUnassignTest extends ServiceFixtures {

    @Autowired
    private TicketRepository ticketRepo;

    @Test
    @DisplayName("omitting assigneeId leaves the assignee exactly where it was")
    void omittingAssigneeIdLeavesItAlone() throws Exception {
        User buyer = customer("9820000340");
        User desk = staff("9820000341", Teams.LEGAL);
        String id = assignedTicket(buyer, desk);

        // A PATCH about something else entirely. The assignee is not mentioned, so it must survive.
        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"waiting\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("waiting"))
                .andExpect(jsonPath("$.assignee").value("Rohit Desk"));

        assertThat(reload(id).getAssigneeId()).isEqualTo(desk.getId());

        // An explicit JSON null is absence, not an instruction — the same request as above.
        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"assigneeId\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignee").value("Rohit Desk"));

        assertThat(reload(id).getAssigneeId()).isEqualTo(desk.getId());
    }

    @Test
    @DisplayName("the reserved value clears the assignee, and does not disturb the rest of the patch")
    void theSentinelClearsTheAssignee() throws Exception {
        User buyer = customer("9820000342");
        User desk = staff("9820000343", Teams.LEGAL);
        String id = assignedTicket(buyer, desk);

        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"assigneeId\":\"" + TicketUpdate.UNASSIGN + "\","
                                + "\"status\":\"open\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignee").value(nullValue()))
                .andExpect(jsonPath("$.status").value("open"));

        // The column, not just the projection — a mapper that lost the name would look identical.
        assertThat(reload(id).getAssigneeId()).isNull();

        // And the ticket is assignable again afterwards; unassigning is a state, not a tombstone.
        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"assigneeId\":\"" + desk.getId() + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignee").value("Rohit Desk"));
    }

    @Test
    @DisplayName("anything else that is not a staff id is still a 404, sentinel or no sentinel")
    void badInputIsStillRefused() throws Exception {
        User buyer = customer("9820000344");
        User desk = staff("9820000345", Teams.LEGAL);
        String id = assignedTicket(buyer, desk);

        // Not a uuid, a near-miss on the sentinel's spelling, and a well-formed id nobody owns.
        // Each would be a data-losing unassignment if the sentinel check were loose.
        refused(desk, id, "definitely-not-a-uuid");
        refused(desk, id, "NONE");
        refused(desk, id, "no-one");
        refused(desk, id, UUID.randomUUID().toString());

        // The original assignee is untouched by all four attempts.
        assertThat(reload(id).getAssigneeId()).isEqualTo(desk.getId());
    }

    /** Raise a legal-desk ticket and assign it, through the API rather than behind its back. */
    private String assignedTicket(User raiser, User assignee) throws Exception {
        String created = mvc.perform(post(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(raiser))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Rent agreement\",\"team\":\"legal\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = field(created, "id");

        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(assignee))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"assigneeId\":\"" + assignee.getId() + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignee").value("Rohit Desk"));
        return id;
    }

    private void refused(User caller, String id, String assigneeId) throws Exception {
        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"assigneeId\":\"" + assigneeId + "\"}"))
                .andExpect(status().isNotFound());
    }

    private Ticket reload(String id) {
        return ticketRepo.findById(UUID.fromString(id)).orElseThrow();
    }

    /** Kept honest: the sentinel must not be something a real user id could ever equal. */
    @Test
    @DisplayName("the sentinel cannot collide with a real id")
    void sentinelCannotCollide() {
        assertThat(TicketUpdate.UNASSIGN).isEqualTo("none");
        assertThat(com.punenest.api.common.web.Ids.parseUuid(TicketUpdate.UNASSIGN)).isEmpty();
        // And it is not a role wire value either, so it cannot be confused with one in an audit row.
        assertThat(TicketUpdate.UNASSIGN).isNotEqualTo(Roles.Wire.STAFF);
    }
}
