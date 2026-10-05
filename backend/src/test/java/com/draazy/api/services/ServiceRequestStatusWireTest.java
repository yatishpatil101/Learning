package com.draazy.api.services;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import com.draazy.api.services.request.ServiceRequest;
import com.draazy.api.services.request.ServiceRequestStatus;
import com.draazy.api.services.request.ServiceRequestTypes;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

// Enum round-trips do not prove the JPA converter; DB writes catch wire/CHECK drift.
@DisplayName("D11 — service request status is stored and read as its wire value")
class ServiceRequestStatusWireTest extends ServiceFixtures {

    // A ninth status added to the enum without widening the CHECK fails this test on the row it cannot insert.
    @Test
    @DisplayName("all nine statuses survive a round trip through the column")
    void everyStatusRoundTripsThroughTheColumn() {
        User buyer = customer("9000000041");
        for (ServiceRequestStatus status : ServiceRequestStatus.values()) {
            UUID id = insertWithRawStatus(buyer, status.wire());

            ServiceRequest loaded = requestRepo.findById(id).orElseThrow();

            assertThat(loaded.getStatus())
                    .as("status literal '%s' must read back as %s", status.wire(), status.name())
                    .isEqualTo(status);
        }
    }

    // The assertion reads the column with `jdbc`, past JPA's cache, so it sees what Postgres holds:
    // `changes-requested`, never the constant name.
    @Test
    @DisplayName("a rejected draft writes 'changes-requested' to the column, not the constant name")
    void aHyphenatedStatusIsWrittenAsItsWireForm() throws Exception {
        User buyer = customer("9000000042");
        User desk = staff("9000000043", Teams.RENTAL);
        Property listing = listing(buyer);

        String id = raise(buyer, ServiceRequestTypes.RENT_AGREEMENT, listing);

        // `new` cannot jump straight to `draft-shared` — the desk has to pick the work up first.
        setStatus(desk, id, "in-progress", 200);
        shareDraft(desk, id, 200);
        reject(buyer, id, "Please fix the start date", 200);

        String stored = jdbc.queryForObject(
                "select status from service_requests where id = ?", String.class,
                UUID.fromString(id));

        assertThat(stored).isEqualTo("changes-requested");
    }

    private UUID insertWithRawStatus(User requester, String status) {
        return jdbc.queryForObject(
                "insert into service_requests (requester_id, type, team, status) "
                        + "values (?, ?, ?, ?) returning id",
                UUID.class, requester.getId(), ServiceRequestTypes.LEGAL,
                ServiceRequestTypes.teamFor(ServiceRequestTypes.LEGAL), status);
    }
}
