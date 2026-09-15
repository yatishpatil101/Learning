package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.moderation.verification.VerificationCases;
import com.draazy.api.security.Roles;
import com.draazy.api.support.Races;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Opening a verification case file is idempotent under concurrency. No {@code @Transactional} —
 * {@code AbstractApiTest}'s rollback would hide every collision — so {@link #cleanUp()} is load-bearing.
 */
@SpringBootTest
@DisplayName("Verification case files under concurrency — one listing, one case file")
class VerificationCaseRaceTest {

        @Test
        void aStaleListingWriterCannotOverwriteAConcurrentLifecycleDecision() {
                Property stale = properties.findById(propertyId).orElseThrow();
                tx.executeWithoutResult(status -> properties.findById(propertyId).orElseThrow().setStatus("approved"));
                stale.revertToPending();
                org.assertj.core.api.Assertions.assertThatThrownBy(() -> properties.saveAndFlush(stale))
                                .isInstanceOf(org.springframework.dao.OptimisticLockingFailureException.class);
                Property current = properties.findById(propertyId).orElseThrow();
                assertThat(current.getStatus()).isEqualTo("approved");
                assertThat(current.getLifecycleStage()).isEqualTo("live");
        }

    /** Distinct from every mobile elsewhere: these rows commit, so a shared number becomes another test's fixture. */
    private static final String OWNER_MOBILE = "9876000221";

    /** Enough to lose the race reliably on a machine with spare cores; small enough to stay quick. */
    private static final int RACERS = 4;

    @Autowired VerificationCases cases;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired PlatformTransactionManager txManager;
    @Autowired JdbcTemplate jdbc;

    private TransactionTemplate tx;
    private UUID propertyId;

    @BeforeEach
    void setUp() {
        tx = new TransactionTemplate(txManager);
        cleanUp();

        User owner = new User(OWNER_MOBILE, Roles.Wire.OWNER);
        owner.setName("Race Owner");
        owner.setMobileVerified(true);
        User saved = users.saveAndFlush(owner);

        Property p = new Property(saved, "2BHK in Kothrud", "rent", "apartment", 32000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("900"));
        p.setStatus(PropertyStatus.PENDING);
        propertyId = properties.saveAndFlush(p).getId();
    }

    /**
     * Ordered children first, then the case file, listing, owner. SQL rather than repositories so a
     * half-created fixture from a failed run stays removable.
     */
    @AfterEach
    void cleanUp() {
        jdbc.update("""
                delete from review_messages where review_id in (
                  select r.id from property_reviews r
                    join properties p on p.id = r.property_id
                    join users u on u.id = p.owner_id
                   where u.mobile = ?)
                """, OWNER_MOBILE);
        jdbc.update("""
                delete from property_review_checklist where review_id in (
                  select r.id from property_reviews r
                    join properties p on p.id = r.property_id
                    join users u on u.id = p.owner_id
                   where u.mobile = ?)
                """, OWNER_MOBILE);
        jdbc.update("""
                delete from property_reviews where property_id in (
                  select p.id from properties p join users u on u.id = p.owner_id where u.mobile = ?)
                """, OWNER_MOBILE);
        jdbc.update("""
                delete from properties where owner_id in (select id from users where mobile = ?)
                """, OWNER_MOBILE);
        jdbc.update("delete from users where mobile = ?", OWNER_MOBILE);
    }

    private long caseFiles() {
        Long n = jdbc.queryForObject(
                "select count(*) from property_reviews where property_id = ?", Long.class, propertyId);
        return n == null ? 0 : n;
    }

    private long checklistRows() {
        Long n = jdbc.queryForObject("""
                select count(*) from property_review_checklist c
                  join property_reviews r on r.id = c.review_id
                 where r.property_id = ?
                """, Long.class, propertyId);
        return n == null ? 0 : n;
    }

    /**
     * Both halves asserted separately: nobody may be handed an error, and exactly one case file may
     * exist. Checklist count catches a fix that reused the row but re-seeded it.
     */
    @Test
    @DisplayName("four simultaneous opens of one listing produce one case file and no errors")
    void concurrentOpensDoNotCollideOnTheUniqueIndex() {
        List<Throwable> outcomes = Races.run(RACERS, index ->
                tx.executeWithoutResult(status -> cases.ensure(propertyId, "rent")));

        assertThat(outcomes.stream().filter(java.util.Objects::nonNull).toList())
                .as("opening a case file somebody else is opening is not the caller's mistake")
                .isEmpty();
        assertThat(caseFiles())
                .as("property_id is UNIQUE — the fix must not be to stop enforcing that")
                .isEqualTo(1);
        assertThat(checklistRows())
                .as("the rental checklist, seeded once and not once per racer")
                .isEqualTo(3);
    }

    /**
     * Every open after the first takes the fast path — it must not take the lock, and it must
     * create nothing. Separate class so this is proved on a cold code path.
     */
    @Test
    @DisplayName("racing an existing case file returns the same one, and creates nothing")
    void concurrentOpensOfAnExistingCaseFileAreReads() {
        UUID first = tx.execute(status -> cases.ensure(propertyId, "rent").getId());
        assertThat(caseFiles()).isEqualTo(1);

        List<Throwable> outcomes = Races.run(RACERS, index ->
                tx.executeWithoutResult(status ->
                        assertThat(cases.ensure(propertyId, "rent").getId()).isEqualTo(first)));

        assertThat(outcomes.stream().filter(java.util.Objects::nonNull).toList()).isEmpty();
        assertThat(caseFiles()).isEqualTo(1);
        assertThat(checklistRows()).isEqualTo(3);
    }
}
