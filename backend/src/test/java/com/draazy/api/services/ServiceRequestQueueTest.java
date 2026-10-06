package com.draazy.api.services;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.services.request.ServiceRequestStatus;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Service requests — staff queue filters and summary")
class ServiceRequestQueueTest extends ServiceFixtures {

    @Test
    @DisplayName("ops can filter by multiple statuses, but unpaid requests stay out of the queue")
    void multiStatusFilter() throws Exception {
        User buyer = customer("9820000601");
        User desk = staff("9820000602", Teams.RENTAL);
        String assigned = raise(buyer, "rent-agreement", listing(buyer));
        String inProgress = raise(buyer, "rent-agreement", listing(buyer));
        String fresh = raise(buyer, "rent-agreement", listing(buyer));
        String unpaid = raiseUnpaid(buyer, listing(buyer));
        force(assigned, ServiceRequestStatus.ASSIGNED, desk);
        force(inProgress, ServiceRequestStatus.IN_PROGRESS, desk);

        mvc.perform(get(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .param("status", "assigned,in-progress"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(2)))
                .andExpect(jsonPath("$.content[*].id", containsInAnyOrder(assigned, inProgress)));

        mvc.perform(get(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .param("status", "assigned"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(1)))
                .andExpect(jsonPath("$.content[0].id").value(assigned));

        mvc.perform(get(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .param("status", "awaiting-payment"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(0)))
                .andExpect(jsonPath("$.content[?(@.id=='" + unpaid + "')]", hasSize(0)))
                .andExpect(jsonPath("$.content[?(@.id=='" + fresh + "')]", hasSize(0)));
    }

    @Test
    @DisplayName("an unknown status inside a comma-separated list is still a 400")
    void unknownStatusInListRejected() throws Exception {
        User desk = staff("9820000603", Teams.RENTAL);

        mvc.perform(get(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .param("status", "assigned,registration"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("Unknown service request status: registration")));
    }

    @Test
    @DisplayName("mine narrows the queue to the caller and assignedToMe is viewer-relative")
    void mineAndAssignedToMe() throws Exception {
        User buyer = customer("9820000604");
        User holder = user("9820000605", Roles.Wire.STAFF, Teams.RENTAL, "Meera Holder");
        User colleague = staff("9820000606", Teams.RENTAL);
        String held = raise(buyer, "rent-agreement", listing(buyer));
        String other = raise(buyer, "rent-agreement", listing(buyer));
        force(held, ServiceRequestStatus.ASSIGNED, holder);
        force(other, ServiceRequestStatus.ASSIGNED, colleague);

        mvc.perform(get(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(holder))
                        .param("mine", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(1)))
                .andExpect(jsonPath("$.content[0].id").value(held))
                .andExpect(jsonPath("$.content[0].assignedToMe").value(true));

        mvc.perform(get(Routes.ServiceRequests.BY_ID, held)
                        .header(HttpHeaders.AUTHORIZATION, bearer(colleague)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignedToMe").value(false));
    }

    @Test
    @DisplayName("queue summary uses the same staff scope and excludes unpaid work")
    void queueSummaryCounts() throws Exception {
        User buyer = customer("9820000607");
        User desk = staff("9820000608", Teams.RENTAL);
        User colleague = staff("9820000609", Teams.RENTAL);
        force(raise(buyer, "rent-agreement", listing(buyer)), ServiceRequestStatus.NEW, null);
        force(raise(buyer, "rent-agreement", listing(buyer)), ServiceRequestStatus.NEW, null,
                Instant.now().minus(Duration.ofHours(5)));
        force(raise(buyer, "rent-agreement", listing(buyer)), ServiceRequestStatus.ASSIGNED, desk);
        force(raise(buyer, "rent-agreement", listing(buyer)), ServiceRequestStatus.DRAFT_SHARED, desk);
        force(raise(buyer, "rent-agreement", listing(buyer)), ServiceRequestStatus.CHANGES_REQUESTED, colleague);
        force(raise(buyer, "rent-agreement", listing(buyer)), ServiceRequestStatus.CANCELLED, null);
        raiseUnpaid(buyer, listing(buyer));
        raise(buyer, "legal", null);

        mvc.perform(get(Routes.ServiceRequests.QUEUE_SUMMARY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .param("team", Teams.RENTAL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.toPickUp").value(2))
                .andExpect(jsonPath("$.mine").value(2))
                .andExpect(jsonPath("$.inProgress").value(2))
                .andExpect(jsonPath("$.withCustomer").value(1))
                .andExpect(jsonPath("$.closed").value(1))
                .andExpect(jsonPath("$.overdue").value(1));
    }

    @Test
    @DisplayName("queue summary is back-office only and mirrors queue desk refusal")
    void queueSummaryAccess() throws Exception {
        User buyer = customer("9820000610");
        User rental = staff("9820000611", Teams.RENTAL);
        User deskless = user("9820000612", Roles.Wire.STAFF, null, "Deskless Staff");

        mvc.perform(get(Routes.ServiceRequests.QUEUE_SUMMARY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());
        mvc.perform(get(Routes.ServiceRequests.QUEUE_SUMMARY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(rental))
                        .param("team", Teams.LEGAL))
                .andExpect(status().isForbidden());
        mvc.perform(get(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(deskless)))
                .andExpect(status().isForbidden());
        mvc.perform(get(Routes.ServiceRequests.QUEUE_SUMMARY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(deskless)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("queue summary carries the desk's open-ticket count, only for callers who can read tickets")
    void queueSummaryOpenTickets() throws Exception {
        User buyer = customer("9820000613");
        User desk = staff("9820000614", Teams.RENTAL);
        User noTickets = staff("9820000615", Teams.RENTAL);
        jdbc.update("update back_office_permissions set permissions = '[\"desk:rental\"]'::jsonb where user_id = ?::uuid",
                noTickets.getId().toString());
        for (String team : new String[] {Teams.RENTAL, Teams.RENTAL, Teams.LEGAL}) {
            mvc.perform(post(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"subject\":\"Help\",\"body\":\"Need a hand\",\"team\":\"" + team + "\"}"))
                    .andExpect(status().isCreated());
        }

        mvc.perform(get(Routes.ServiceRequests.QUEUE_SUMMARY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .param("team", Teams.RENTAL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openTickets").value(2));
        mvc.perform(get(Routes.ServiceRequests.QUEUE_SUMMARY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(noTickets))
                        .param("team", Teams.RENTAL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openTickets").doesNotExist());
    }

    private void force(String id, ServiceRequestStatus status, User assignee) {
        force(id, status, assignee, Instant.now());
    }

    private void force(String id, ServiceRequestStatus status, User assignee, Instant changedAt) {
        jdbc.update("""
                update service_requests
                set status = ?, assignee_id = cast(? as uuid), status_changed_at = ?
                where id = cast(? as uuid)
                """, status.wire(), assignee == null ? null : assignee.getId().toString(),
                Timestamp.from(changedAt), id);
        em.clear();
    }
}
