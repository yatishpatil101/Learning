package com.punenest.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.moderation.verification.VerificationCases;
import com.punenest.api.security.Roles;
import com.punenest.api.support.Races;
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
 * Opening a verification case file is idempotent when two people do it at once.
 *
 * <p><strong>The bug this is about.</strong> {@code VerificationCases.ensure} was
 * {@code findByPropertyId(...).orElseGet(insert)}, and its own Javadoc called that idempotent
 * because {@code property_reviews.property_id} is UNIQUE. The constraint is real and the claim was
 * half true: it holds for two calls in a row, and not for two calls at once. Two transactions both
 * read no row, both insert, and the loser is handed
 * {@code duplicate key value violates unique constraint "property_reviews_property_id_key"} — a
 * moderator told the database rejected their write for opening a listing a colleague opened in the
 * same second.
 *
 * <p>It was not hypothetical, and it was not rare. React's development double-mount fires the review
 * modal's open request twice concurrently, so the <em>first</em> case file opened after every
 * database reset failed, every time — which is how it was found: the same live spec red as the first
 * test of a run and green as the second, with the identical helper.
 *
 * <p><strong>Read the annotations before the assertions.</strong> There is no {@code @Transactional}
 * here and there cannot be. {@code AbstractApiTest} rolls back, and a rolled-back insert is
 * invisible to every other connection forever — so the racing threads would never collide and the
 * test would pass identically against the broken code. That is the same reasoning
 * {@code RateLimitRaceTest} sets out at length; this class is its second customer, which is why
 * {@link Races} is shared rather than local. The rows here commit, so {@link #cleanUp()} is
 * load-bearing.
 *
 * <p>{@code ensure} is {@code MANDATORY}, so the {@link TransactionTemplate} is supplying what a
 * caller would rather than working around it — and it is also what gives the advisory lock the
 * lifetime it needs, since {@code pg_advisory_xact_lock} is released by the caller's commit.
 */
@SpringBootTest
@DisplayName("Verification case files under concurrency — one listing, one case file")
class VerificationCaseRaceTest {

    /**
     * Distinct from every mobile used elsewhere in the suite. These rows genuinely commit, so a
     * shared number would make this test's litter another test's fixture.
     */
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
     * Ordered children first, then the case file, then the listing, then the owner. Written as SQL
     * rather than through the repositories because a half-created fixture from a failed run has to
     * be removable too, and a delete that depends on the object graph loading is a delete that stops
     * working exactly when it is needed.
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
     * Four moderators open the same listing at the same instant.
     *
     * <p>Both halves of the claim are asserted, and neither implies the other. Nobody may be handed
     * an error, because the caller did nothing wrong — this is the assertion that fails against the
     * old code, and it fails with the constraint violation quoted verbatim in the class comment. And
     * exactly one case file may exist, because a fix that swallowed the collision and let two rows
     * through would satisfy the first assertion while breaking the thing the UNIQUE index is there
     * to protect.
     *
     * <p>The checklist count is the third: a rental case opens with three items, and a second
     * insert that partially succeeded would show up here as six. Cheap, and it is the only
     * assertion that would notice a fix which reused the row but re-ran the seeding.
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
     * The same four racers arriving after the case file already exists.
     *
     * <p>This is the path every open after the first one takes, and it is the one the fast path in
     * {@code ensure} exists for — it must not take the lock, and more importantly it must not have
     * regressed into creating anything. Kept separate from the test above rather than folded into
     * it because a single test that opened and then re-opened would prove the second behaviour only
     * on a code path warmed by the first.
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
