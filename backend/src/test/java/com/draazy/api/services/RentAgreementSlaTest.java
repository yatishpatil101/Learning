package com.draazy.api.services;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import jakarta.persistence.EntityManager;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.ResultActions;

// The desk SLA is measured from when a rent agreement became actionable, without a sweep.
@DisplayName("Rent agreement SLA — due-by per status, overdue on the queue")
class RentAgreementSlaTest extends ServiceFixtures {

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    EntityManager em;

    private void enteredStatusAgo(String id, Duration ago) {
        em.flush();
        jdbc.update("update service_requests set status_changed_at = ? where id = ?",
                java.sql.Timestamp.from(Instant.now().minus(ago)), UUID.fromString(id));
        // The test transaction spans the request, so cached entities must be dropped to see the write.
        em.clear();
    }

    private ResultActions read(User caller, String id) throws Exception {
        return mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))).andExpect(status().isOk());
    }

    private ResultActions overdueQueue(User caller) throws Exception {
        return mvc.perform(get(Routes.ServiceRequests.BASE)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                .param("overdue", "true")).andExpect(status().isOk());
    }

    @Test
    @DisplayName("pickup, draft, the customer's turn and registration each carry their own clock")
    void eachStatusHasItsClock() throws Exception {
        User owner = customer("9820007001");
        User desk = staff("9820007002", Teams.RENTAL);
        String id = raise(owner, "rent-agreement", listing(owner));

        read(owner, id)
                .andExpect(jsonPath("$.sla.waitingOn").value("desk"))
                .andExpect(jsonPath("$.sla.overdue").value(false))
                .andExpect(jsonPath("$.sla.dueAt").isNotEmpty());
        overdueQueue(desk).andExpect(jsonPath("$.content", hasSize(0)));

        enteredStatusAgo(id, Duration.ofHours(5));
        read(desk, id).andExpect(jsonPath("$.sla.overdue").value(true));
        overdueQueue(desk)
                .andExpect(jsonPath("$.content", hasSize(1)))
                .andExpect(jsonPath("$.content[0].id").value(id));

        setStatus(desk, id, "assigned", 200);
        read(desk, id).andExpect(jsonPath("$.sla.overdue").value(false));
        overdueQueue(desk).andExpect(jsonPath("$.content", hasSize(0)));
        enteredStatusAgo(id, Duration.ofHours(47));
        overdueQueue(desk).andExpect(jsonPath("$.content", hasSize(0)));
        enteredStatusAgo(id, Duration.ofHours(49));
        overdueQueue(desk).andExpect(jsonPath("$.content", hasSize(1)));

        shareDraft(desk, id, 200);
        enteredStatusAgo(id, Duration.ofDays(30));
        read(owner, id)
                .andExpect(jsonPath("$.sla.waitingOn").value("customer"))
                .andExpect(jsonPath("$.sla.dueAt").value(nullValue()))
                .andExpect(jsonPath("$.sla.overdue").value(false));
        overdueQueue(desk).andExpect(jsonPath("$.content", hasSize(0)));

        openDraft(owner, id, 204);
        decide(owner, id, "approve", 200);
        enteredStatusAgo(id, Duration.ofDays(8));
        read(desk, id)
                .andExpect(jsonPath("$.sla.waitingOn").value("desk"))
                .andExpect(jsonPath("$.sla.overdue").value(true));

        finalDoc(desk, id, 201);
        read(desk, id).andExpect(jsonPath("$.sla").value(nullValue()));
    }

    @Test
    @DisplayName("other desks carry no SLA, and a customer's overdue flag filters nothing")
    void onlyRentAgreementsAreTimed() throws Exception {
        User owner = customer("9820007011");
        String valuation = raise(owner, "valuation", listing(owner));
        String rental = raise(owner, "rent-agreement", listing(owner));
        enteredStatusAgo(valuation, Duration.ofDays(10));
        read(owner, valuation).andExpect(jsonPath("$.sla").value(nullValue()));

        overdueQueue(owner).andExpect(jsonPath("$.content", hasSize(2)));
        overdueQueue(admin("9820007012"))
                .andExpect(jsonPath("$.content", hasSize(0)));
        enteredStatusAgo(rental, Duration.ofHours(5));
        overdueQueue(admin("9820007013"))
                .andExpect(jsonPath("$.content", hasSize(1)))
                .andExpect(jsonPath("$.content[0].id").value(rental));
    }
}
