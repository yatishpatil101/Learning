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

/**
 * The column ↔ enum mapping for {@code service_requests.status} (D11).
 *
 * <p><strong>Why this suite exists.</strong> {@link ServiceRequestStatus} was promoted from a
 * {@code String} constant holder to a real enum, and the promotion has exactly one way to go wrong:
 * something writes {@link Enum#name()} instead of {@link ServiceRequestStatus#wire()}. Four of the
 * nine values are hyphenated — {@code awaiting-payment}, {@code in-progress}, {@code draft-shared},
 * {@code changes-requested} — so {@code name()} escaping into the column would produce
 * {@code AWAITING_PAYMENT}, which the V7 CHECK rejects, or into the JSON, which every client reads.
 * The default JPA behaviour ({@code @Enumerated(EnumType.STRING)}) does precisely that, which is why
 * {@link ServiceRequestStatus.Converter} is named explicitly on the field instead.
 *
 * <p><strong>Through the database, not through the object.</strong> Asserting
 * {@code fromWire(s.wire()) == s} would pass with the converter deleted; it only proves the enum is
 * self-consistent. Both tests here cross the connection: one inserts the wire value as a literal and
 * reads it back through JPA, the other drives the real workflow and reads the raw column back with
 * {@code jdbc}. Between them they pin both directions of the mapping and the CHECK that constrains
 * it.
 */
@DisplayName("D11 — service request status is stored and read as its wire value")
class ServiceRequestStatusWireTest extends ServiceFixtures {

    /**
     * Every value the enum can take is a value the column accepts, and reads back as the same
     * constant.
     *
     * <p>The insert is a literal, so the V7 CHECK judges {@link ServiceRequestStatus#wire()} rather
     * than judging the converter's opinion of it: a value the enum invented that the table does not
     * allow fails here with a constraint violation. The read is through the repository, so the
     * converter has to map the literal back to the right constant. A ninth status added to the enum
     * without widening the CHECK fails this test on the row it cannot insert.
     */
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

    /**
     * The write direction, on the value where {@code name()} and {@code wire()} differ most.
     *
     * <p>Driven through the real D121 rejection rather than by setting the field, because the field
     * has no public setter and because the path a customer actually takes is the one worth pinning.
     * The assertion reads the column with {@code jdbc}, past JPA and past its first-level cache, so
     * what it sees is what Postgres holds: {@code changes-requested}, never
     * {@code CHANGES_REQUESTED}.
     */
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
        decide(buyer, id, "reject", 200);

        String stored = jdbc.queryForObject(
                "select status from service_requests where id = ?", String.class,
                UUID.fromString(id));

        assertThat(stored).isEqualTo(ServiceRequestStatus.CHANGES_REQUESTED.wire());
        assertThat(stored).isEqualTo("changes-requested");
        assertThat(stored).isNotEqualTo(ServiceRequestStatus.CHANGES_REQUESTED.name());
    }

    /**
     * A row at a given status, inserted past the service.
     *
     * <p>{@code team} is stated rather than omitted for the same reason
     * {@code ServiceRequestUnpaidExitTest} states it: V72 made it {@code NOT NULL} and paired it to
     * {@code type} by CHECK, and it is resolved through the same map production uses so the fixture
     * cannot drift from it.
     */
    private UUID insertWithRawStatus(User requester, String status) {
        return jdbc.queryForObject(
                "insert into service_requests (requester_id, type, team, status) "
                        + "values (?, ?, ?, ?) returning id",
                UUID.class, requester.getId(), ServiceRequestTypes.LEGAL,
                ServiceRequestTypes.teamFor(ServiceRequestTypes.LEGAL), status);
    }
}
