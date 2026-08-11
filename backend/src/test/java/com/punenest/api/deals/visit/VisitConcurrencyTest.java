package com.punenest.api.deals.visit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.OptimisticLockingFailureException;

/**
 * Deterministic stale-write proof for visits (D146).
 *
 * <p>Threaded races are flaky. This test reproduces the real failure mode deterministically by
 * detaching one copy, committing another, and then trying to save the stale copy.
 */
@DisplayName("Slice D146 - visits optimistic locking")
class VisitConcurrencyTest extends AbstractApiTest {

    @Autowired
    VisitRepository visits;

    @Autowired
    UserRepository users;

    @Autowired
    PropertyRepository properties;

    @PersistenceContext
    EntityManager em;

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Test User");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private Visit seedVisit(User visitor, Property property) {
        Visit visit = new Visit(property.getId(), visitor.getId(),
                Instant.now().plus(2, ChronoUnit.DAYS), VisitModes.IN_PERSON, null);
        return visits.saveAndFlush(visit);
    }

    private long version(UUID id) {
        return jdbc.queryForObject("select version from visits where id = ?::uuid", Long.class, id);
    }

    @Test
    @DisplayName("stale write is rejected instead of silently overwriting")
    void staleWriteIsRejected() {
        User owner = user("9820300001", "owner");
        User visitor = user("9820300002", "buyer");
        Property property = listing(owner, "Visit optimistic lock test");
        Visit created = seedVisit(visitor, property);

        Visit stale = visits.findById(created.getId()).orElseThrow();
        em.detach(stale);

        Visit winner = visits.findById(created.getId()).orElseThrow();
        winner.setStatus(VisitStatuses.CONFIRMED);
        visits.saveAndFlush(winner);
        assertThat(version(created.getId())).isEqualTo(1L);
        assertThat(visits.findById(created.getId()).orElseThrow().getStatus())
            .isEqualTo(VisitStatuses.CONFIRMED);

        stale.reschedule(Instant.now().plus(5, ChronoUnit.DAYS));
        // Nothing should follow this assertion in this test transaction: a failed optimistic lock
        // marks it rollback-only, so the winner-survived half is asserted above.
        assertThatThrownBy(() -> visits.saveAndFlush(stale))
                .isInstanceOf(OptimisticLockingFailureException.class);
    }

    @Test
    @DisplayName("version starts at 0 and increments on each update")
    void versionIncrementsPerUpdate() {
        User owner = user("9820300003", "owner");
        User visitor = user("9820300004", "buyer");
        Property property = listing(owner, "Visit version progression test");
        Visit visit = seedVisit(visitor, property);

        assertThat(version(visit.getId())).isZero();

        visit.setStatus(VisitStatuses.CONFIRMED);
        visits.saveAndFlush(visit);
        assertThat(version(visit.getId())).isEqualTo(1L);

        visit.reschedule(Instant.now().plus(6, ChronoUnit.DAYS));
        visits.saveAndFlush(visit);
        assertThat(version(visit.getId())).isEqualTo(2L);
    }
}
