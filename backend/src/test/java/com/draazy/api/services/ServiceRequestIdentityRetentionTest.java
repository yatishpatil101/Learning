package com.draazy.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.services.request.IdentityCipher;
import com.draazy.api.services.request.ServiceRequestIdentityRetention;
import com.draazy.api.security.Teams;
import jakarta.persistence.EntityManager;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Identity numbers on an open request expire when the request stops moving")
class ServiceRequestIdentityRetentionTest extends ServiceFixtures {

    @Autowired
    ServiceRequestIdentityRetention retention;

    @Autowired
    EntityManager em;

    @Autowired
    IdentityCipher cipher;

    @Test
    @DisplayName("a request idle for 60 days loses its numbers and says so on the timeline")
    void idleRequestIsPurged() throws Exception {
        User buyer = customer("9820000901");
        User desk = staff("9820000902", Teams.RENTAL);
        String id = raise(buyer, "rent-agreement", listing(buyer));
        record(buyer, id);
        setStatus(desk, id, "cancelled", 200);
        User other = customer("9820000903");
        String open = raise(other, "rent-agreement", listing(other));
        record(other, open);

        retention.purgeAsOf(Instant.now().plus(Duration.ofDays(59)));
        assertThat(heldAadhaars(open)).containsOnly("211122223335");

        assertThat(retention.purgeAsOf(Instant.now().plus(Duration.ofDays(61)))).isPositive();
        assertThat(heldAadhaars(open)).containsOnlyNulls();
        assertThat(timeline(open)).containsOnlyOnce("identities.purged");
        assertThat(timeline(id)).containsOnlyOnce("identities.purged");
    }

    @Test
    @DisplayName("a request that keeps moving still loses its numbers 180 days after they were recorded")
    void heldClockCapsAnActiveRequest() throws Exception {
        User buyer = customer("9820000904");
        String id = raise(buyer, "rent-agreement", listing(buyer));
        record(buyer, id);
        recordedDaysAgo(id, 179);
        retention.purgeAsOf(Instant.now());
        assertThat(heldAadhaars(id)).containsOnly("211122223335");

        recordedDaysAgo(id, 181);
        retention.purgeAsOf(Instant.now());
        assertThat(heldAadhaars(id)).containsOnlyNulls();
    }

    @Test
    @DisplayName("recording numbers counts as activity even though it leaves the request row untouched")
    void recordingRestartsTheIdleClock() throws Exception {
        User buyer = customer("9820000905");
        String id = raise(buyer, "rent-agreement", listing(buyer));
        record(buyer, id);
        recordedDaysAgo(id, -30);
        retention.purgeAsOf(Instant.now().plus(Duration.ofDays(61)));
        assertThat(heldAadhaars(id)).containsOnly("211122223335");
    }

    @Test
    @DisplayName("the requester records them again after a purge, and the timeline says so once (D282)")
    void requesterReRecordsAfterPurge() throws Exception {
        User buyer = customer("9820000906");
        User desk = staff("9820000907", Teams.RENTAL);
        String id = raise(buyer, "rent-agreement", listing(buyer));
        record(buyer, id);
        retention.purgeAsOf(Instant.now().plus(Duration.ofDays(61)));
        assertThat(heldAadhaars(id)).containsOnlyNulls();

        record(buyer, id);
        record(buyer, id);
        assertThat(heldAadhaars(id)).containsOnly("211122223335");
        assertThat(timeline(id)).containsOnlyOnce("identities.purged", "identities.recorded");

        setStatus(desk, id, "cancelled", 200);
        mvc.perform(put(Routes.ServiceRequests.IDENTITIES, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"parties":[{"partyRole":"owner","partyIndex":0,"aadhaar":"211122223335"}]}"""))
                .andExpect(status().isConflict());
    }

    private void recordedDaysAgo(String id, int days) {
        em.flush();
        jdbc.update("update service_request_identities set created_at = ? where service_request_id = ?",
                Timestamp.from(Instant.now().minus(Duration.ofDays(days))), UUID.fromString(id));
    }

    private void record(User caller, String id) throws Exception {
        mvc.perform(put(Routes.ServiceRequests.IDENTITIES, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"parties":[{"partyRole":"owner","partyIndex":0,"partyName":"Asha Patil",
                                  "aadhaar":"211122223335"}]}"""))
                .andExpect(status().isNoContent());
    }

    private List<String> heldAadhaars(String id) {
        em.flush();
        em.clear();
        return jdbc.queryForList("select aadhaar from service_request_identities where service_request_id = ?",
                String.class, UUID.fromString(id)).stream().map(cipher::decrypt).toList();
    }

    private List<String> timeline(String id) {
        em.flush();
        return jdbc.queryForList("select event from service_request_timeline where request_id = ?",
                String.class, UUID.fromString(id));
    }
}
