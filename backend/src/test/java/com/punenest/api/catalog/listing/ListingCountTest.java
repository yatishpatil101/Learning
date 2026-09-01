package com.punenest.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/**
 * The lifetime listing tally, asserted at the column rather than at the object.
 *
 * <p><strong>Why this class exists.</strong> {@code users.listings_count} spent its whole life as a
 * declared column with no writer: it was added in the old {@code V2__identity_access.sql} (now
 * folded into {@code V02__DDL_identity_access.sql}), no Java ever
 * called a setter, and only the demo seed put numbers in it — so on every real account it read
 * {@code 0} for ever, while the seeded fixtures made it look answered. Three surfaces read it, and
 * all three were quietly wrong. The write now exists ({@link
 * com.punenest.api.identity.user.User#recordListingPosted()}, called from {@code
 * ListingService.createOnBehalf}), and this is what stops it going back to being decorative.
 *
 * <p><strong>The failure it is actually here to catch is silent.</strong> The increment is a
 * dirty-check write on the managed {@code owner} loaded at the top of {@code createOnBehalf} — it
 * persists only because nothing between that load and the increment detaches the entity. Roughly
 * eight repository methods in this codebase carry {@code @Modifying(clearAutomatically = true)},
 * and one of them added to that method, above the increment, would clear the persistence context
 * and drop the write with no error, no log line and no failing test anywhere else. A comment warns
 * about it; a comment is not a guard. Hence the shape below.
 *
 * <p><strong>Why {@code flush()} + {@code clear()} + raw SQL, and not {@code users.findById}.</strong>
 * {@link AbstractApiTest} is {@code @Transactional}, so the MockMvc request joins the test's own
 * transaction and its persistence context. A repository read after the post would return the very
 * same managed instance the service mutated, straight out of the first-level cache — it would
 * report {@code 1} even if the UPDATE were never emitted, which is exactly the bug. Flushing forces
 * the statement out, clearing evicts the cached copy, and reading the column with {@code jdbc}
 * asks the database rather than Hibernate. Any of the three omitted and this test passes vacuously.
 */
@DisplayName("Listings count — the column that used to have no writer")
class ListingCountTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired EntityManager em;

    private static final String BODY = """
            {"title":"%s","deal":"rent","propertyType":"apartment","price":25000,
             "locality":"Kothrud","city":"Pune"}
            """;

    private User owner(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Tally " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** The count as {@code users} actually holds it, with Hibernate's cached copy taken out of the way. */
    private int storedCount(UUID id) {
        em.flush();
        em.clear();
        Integer n = jdbc.queryForObject("select listings_count from users where id = ?", Integer.class, id);
        return n == null ? 0 : n;
    }

    private void postListing(User o, String title) throws Exception {
        mvc.perform(post("/me/listings").header("Authorization", bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY.formatted(title)))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("posting a listing moves the owner's count in the database, not just in the session")
    void postingIncrementsTheStoredCount() throws Exception {
        User o = owner("9862000001");
        assertThat(storedCount(o.getId())).as("a new account has posted nothing").isZero();

        postListing(o, "First flat in Kothrud");

        assertThat(storedCount(o.getId()))
                .as("the increment reached the users row — if this reads 0, something between the "
                        + "owner load and recordListingPosted() detached the entity")
                .isEqualTo(1);
    }

    /**
     * The tally counts posts, and archiving is not an un-post.
     *
     * <p>This is the distinction the three reading surfaces depend on and the one a future tidy-up
     * is most likely to erase. {@code ListingQuotaTest} proves archiving hands the free-tier
     * <em>slot</em> back, which is right — the ceiling is one listing at a time. It would be an easy
     * and wrong inference to decrement this counter in the same breath: the plan card and the
     * referral badge are asking "did this person come here to list", and an owner who let their flat
     * and took the ad down did. A decrement would silently demote them back to seeker.
     */
    @Test
    @DisplayName("archiving the listing hands back the slot but does not undo the tally")
    void archivingDoesNotDecrementTheTally() throws Exception {
        User o = owner("9862000002");
        postListing(o, "Flat that will be taken down");
        assertThat(storedCount(o.getId())).isEqualTo(1);

        UUID listingId = jdbc.queryForObject(
                "select id from properties where owner_id = ?", UUID.class, o.getId());
        mvc.perform(delete("/me/listings/" + listingId).header("Authorization", bearer(o)))
                .andExpect(status().isOk());

        assertThat(storedCount(o.getId()))
                .as("lifetime tally, not live inventory — see User.recordListingPosted")
                .isEqualTo(1);
    }

    /**
     * One post, one increment — a second listing does not re-set the count to 1.
     *
     * <p>The free tier is one live listing, so the first has to be archived before the second is
     * allowed; that the count still climbs to 2 across that archive is what makes it a tally rather
     * than a boolean stored in an int, and it is the property {@code V125}'s backfill and the seed's
     * recompute both have to agree with.
     */
    @Test
    @DisplayName("a second listing takes the count to two, across the archive that freed the slot")
    void theCountAccumulates() throws Exception {
        User o = owner("9862000003");
        postListing(o, "First listing");

        UUID first = jdbc.queryForObject(
                "select id from properties where owner_id = ?", UUID.class, o.getId());
        mvc.perform(delete("/me/listings/" + first).header("Authorization", bearer(o)))
                .andExpect(status().isOk());

        postListing(o, "Second listing");

        assertThat(storedCount(o.getId())).isEqualTo(2);
    }

    /**
     * The role stays {@code buyer}, and that is the point of the whole change.
     *
     * <p>Posting a listing does not promote anybody: nothing in the application calls {@code setRole}
     * outside account creation, both signup paths mint {@code buyer}, and the {@code owner} role is
     * therefore unreachable. That is precisely why the reading surfaces had to stop asking {@code
     * role == 'owner'} and start asking this counter. If a promotion hook is ever added, this
     * assertion is the one that should fail and force the decision to be made deliberately.
     */
    @Test
    @DisplayName("posting does not promote the account to the owner role")
    void postingDoesNotChangeTheRole() throws Exception {
        User o = owner("9862000004");
        postListing(o, "A listing from a buyer-role account");

        String role = jdbc.queryForObject("select role from users where id = ?", String.class, o.getId());
        assertThat(role)
                .as("no code path assigns 'owner'; hasEverListed exists because this stays 'buyer'")
                .isEqualTo("buyer");
    }
}
