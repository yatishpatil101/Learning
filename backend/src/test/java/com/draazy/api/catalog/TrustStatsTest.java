package com.draazy.api.catalog;

import com.draazy.api.support.AbstractApiTest;

import static org.hamcrest.Matchers.greaterThan;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * {@code GET /properties/trust-stats} — the verified share of the live catalogue.
 *
 * <p>These three numbers were computed in the browser until now, from whichever listings the
 * homepage had already loaded. Each test here pins one of the ways that was wrong, so a regression
 * has to reintroduce a specific defect rather than merely drift.
 *
 * <p>Every test narrows to its own locality slug. The seeded catalogue is shared and its shape is
 * not this test's fixture: asserting on catalogue-wide totals would make these tests fail whenever
 * somebody seeds another flat, which is the kind of red that teaches people to ignore red.
 */
class TrustStatsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /** A slug no seed uses, so each test owns its slice of the catalogue outright. */
    private static final String SLUG = "trust-stats-fixture";

    /**
     * The fixture locality has to exist before anything can be listed in it.
     *
     * <p>{@code properties.locality_slug} carries a foreign key to {@code localities}, which is the
     * reason these tests cannot simply invent a slug and why they do not borrow a seeded one either:
     * a seeded locality already has listings, and a test that counts them is a test that fails the
     * next time somebody seeds a flat. Rolled back with the rest of the transaction.
     */
    @BeforeEach
    void createFixtureLocality() {
        jdbc.update("insert into localities (slug, name, city) values (?, ?, 'Pune')"
                + " on conflict (slug) do nothing", SLUG, "Trust Stats Fixture");
    }

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title, String status) {
        return listingIn(owner, title, status, SLUG);
    }

    private Property listingIn(User owner, String title, String status, String localitySlug) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setLocalitySlug(localitySlug);
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    // ---------------- reachability ----------------

    /**
     * The headline answers with no Authorization header.
     *
     * <p>It is named explicitly in the security chain rather than left to
     * {@code Routes.Properties.ANY_SINGLE}, and this is the test that would notice if that entry
     * were dropped on the assumption that the single-segment matcher still covered it.
     */
    @Test
    void theTrustHeadlineIsPublic() throws Exception {
        mvc.perform(get("/properties/trust-stats")).andExpect(status().isOk());
        mvc.perform(get("/properties/trust-stats").param("locality", "kothrud"))
                .andExpect(status().isOk());
    }

    /**
     * A literal path outranks the {@code /properties/{id}} template.
     *
     * <p>Worth its own assertion because the failure mode is not a 404: {@code trust-stats} would be
     * read as a slug, the lookup would miss, and the homepage would get a listing-not-found where it
     * asked for a count. The three keys being present is what proves which handler ran.
     */
    @Test
    void theRouteIsNotSwallowedByTheSingleListingLookup() throws Exception {
        mvc.perform(get("/properties/trust-stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListings").exists())
                .andExpect(jsonPath("$.verifiedListings").exists())
                .andExpect(jsonPath("$.verifiedOwners").exists());
    }

    // ---------------- what counts as live ----------------

    /**
     * Only approved, unarchived listings are counted.
     *
     * <p>Four listings, one live. A total of 4 means the moderation predicate was dropped, which
     * would put pending and rejected listings into a number a visitor reads as "homes you can look
     * at right now".
     */
    @Test
    void onlyApprovedAndUnarchivedListingsAreCounted() throws Exception {
        User asha = owner("9811100001");
        listing(asha, "Live flat", PropertyStatus.APPROVED);
        listing(asha, "Pending flat", PropertyStatus.PENDING);
        listing(asha, "Rejected flat", PropertyStatus.REJECTED);
        Property gone = listing(asha, "Archived flat", PropertyStatus.APPROVED);
        gone.archive("owner withdrew");
        properties.saveAndFlush(gone);

        mvc.perform(get("/properties/trust-stats").param("locality", SLUG))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListings").value(1))
                .andExpect(jsonPath("$.verifiedListings").value(0))
                .andExpect(jsonPath("$.verifiedOwners").value(0));
    }

    /**
     * An unknown locality answers zeroes rather than {@code 404}.
     *
     * <p>This is a headline about a slice of the catalogue, and a slice with nothing in it is a real
     * answer — a locality that has just been added has genuinely zero verified listings. Answering
     * 404 would also make the endpoint a cheap oracle for which slugs exist.
     */
    @Test
    void anUnknownLocalityAnswersZeroesRatherThanNotFound() throws Exception {
        mvc.perform(get("/properties/trust-stats").param("locality", "no-such-locality-anywhere"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListings").value(0))
                .andExpect(jsonPath("$.verifiedListings").value(0))
                .andExpect(jsonPath("$.verifiedOwners").value(0));
    }

    // ---------------- the two badges ----------------

    /**
     * Either badge makes a listing verified, and carrying both does not count it twice.
     *
     * <p>Three live listings: one owner-verified, one ownership-verified, one carrying both. The
     * expected answer is 3. A 4 means the two clauses were summed instead of or'd, which is the
     * arithmetic that lets {@code verifiedListings} exceed {@code totalListings} — the one thing a
     * share must never do.
     */
    @Test
    void eitherBadgeCountsAndBothTogetherCountOnce() throws Exception {
        User asha = owner("9811100002");
        Property ownerOnly = listing(asha, "Owner verified", PropertyStatus.APPROVED);
        ownerOnly.setOwnerVerified(true);
        properties.saveAndFlush(ownerOnly);

        Property deedOnly = listing(asha, "Ownership verified", PropertyStatus.APPROVED);
        deedOnly.verifyOwnership(Instant.now(), Instant.now().plus(Duration.ofDays(30)));
        properties.saveAndFlush(deedOnly);

        Property both = listing(asha, "Both badges", PropertyStatus.APPROVED);
        both.setOwnerVerified(true);
        both.verifyOwnership(Instant.now(), null);
        properties.saveAndFlush(both);

        mvc.perform(get("/properties/trust-stats").param("locality", SLUG))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListings").value(3))
                .andExpect(jsonPath("$.verifiedListings").value(3));
    }

    /**
     * An ownership verdict whose evidence has expired does not count — the badge lapsed with it.
     *
     * <p>The whole point of the clause that spells out {@code ownership_verified_until > now}
     * instead of reading {@code ownership_verified} alone. {@code Property.isOwnershipVerified()} is
     * derived and lapses with no write to the row, so the column stays {@code true} long after the
     * badge has gone from the listing page. Counting the column would tell a visitor that a listing
     * is verified while the listing itself says it is not.
     *
     * <p>Mutation check: drop the {@code ownershipVerifiedUntil} condition from the query and this
     * expects 2 and gets 3.
     */
    @Test
    void anExpiredOwnershipVerdictDoesNotCountBecauseTheBadgeIsGone() throws Exception {
        User asha = owner("9811100003");
        Property current = listing(asha, "Still valid", PropertyStatus.APPROVED);
        current.verifyOwnership(
                Instant.now().minus(Duration.ofDays(10)), Instant.now().plus(Duration.ofDays(10)));
        properties.saveAndFlush(current);

        Property neverLapses = listing(asha, "No expiry recorded", PropertyStatus.APPROVED);
        neverLapses.verifyOwnership(Instant.now().minus(Duration.ofDays(400)), null);
        properties.saveAndFlush(neverLapses);

        Property lapsed = listing(asha, "Proof ran out", PropertyStatus.APPROVED);
        lapsed.verifyOwnership(
                Instant.now().minus(Duration.ofDays(200)), Instant.now().minus(Duration.ofDays(1)));
        properties.saveAndFlush(lapsed);

        mvc.perform(get("/properties/trust-stats").param("locality", SLUG))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListings").value(3))
                .andExpect(jsonPath("$.verifiedListings").value(2));
    }

    // ---------------- verifiedOwners counts people ----------------

    /**
     * One owner with three verified listings is one verified owner.
     *
     * <p>This is the number that could not be computed in the browser at all, and the reason the
     * endpoint exists: the list response carries no {@code ownerId}, so the page had no way to tell
     * three flats from one landlord apart from three flats from three. Counting rows would inflate
     * the figure precisely for the prolific poster a visitor has least reason to trust on volume.
     *
     * <p>Mutation check: drop {@code distinct} and this expects 2 and gets 4.
     */
    @Test
    void verifiedOwnersCountsPeopleNotListings() throws Exception {
        User asha = owner("9811100004");
        User bhavna = owner("9811100005");
        for (String title : new String[] {"Asha one", "Asha two", "Asha three"}) {
            Property p = listing(asha, title, PropertyStatus.APPROVED);
            p.setOwnerVerified(true);
            properties.saveAndFlush(p);
        }
        Property hers = listing(bhavna, "Bhavna one", PropertyStatus.APPROVED);
        hers.setOwnerVerified(true);
        properties.saveAndFlush(hers);

        mvc.perform(get("/properties/trust-stats").param("locality", SLUG))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListings").value(4))
                .andExpect(jsonPath("$.verifiedListings").value(4))
                .andExpect(jsonPath("$.verifiedOwners").value(2));
    }

    /**
     * An ownership-verified listing does not make its owner a verified owner.
     *
     * <p>The two badges say different things: one is that this person proved who they are, the other
     * that this listing's paperwork checked out. A landlord who has never shown ID can still have a
     * verified deed, and rolling that up into "verified owners" would let the weaker claim borrow
     * the stronger one's wording on the homepage.
     */
    @Test
    void aVerifiedDeedDoesNotMakeItsOwnerAVerifiedPerson() throws Exception {
        User asha = owner("9811100006");
        Property p = listing(asha, "Deed but no ID", PropertyStatus.APPROVED);
        p.verifyOwnership(Instant.now(), null);
        properties.saveAndFlush(p);

        mvc.perform(get("/properties/trust-stats").param("locality", SLUG))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListings").value(1))
                .andExpect(jsonPath("$.verifiedListings").value(1))
                .andExpect(jsonPath("$.verifiedOwners").value(0));
    }

    /**
     * A verified owner whose only listing is not live counts for nothing.
     *
     * <p>The distinct-owner count is scoped by the same live predicate as the other two, so all
     * three numbers describe the same slice. Without that, a locality could report more verified
     * owners than it has listings, which reads as a shortage of homes rather than as a bug.
     */
    @Test
    void aVerifiedOwnerWithNothingLiveIsNotCounted() throws Exception {
        User asha = owner("9811100007");
        Property pending = listing(asha, "Awaiting moderation", PropertyStatus.PENDING);
        pending.setOwnerVerified(true);
        properties.saveAndFlush(pending);

        mvc.perform(get("/properties/trust-stats").param("locality", SLUG))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListings").value(0))
                .andExpect(jsonPath("$.verifiedOwners").value(0));
    }

    // ---------------- scoping ----------------

    /**
     * The locality parameter narrows; without it a listing elsewhere is counted too.
     *
     * <p>Both sides of the comparison are planted by this test rather than borrowed from the seed.
     * The first version leaned on the catalogue being non-empty and failed on a database where it
     * was — the test profile seeds no listings at all — which was the test's fault and not the
     * endpoint's, and exactly the kind of red that gets a working assertion deleted.
     *
     * <p>A filter silently ignored makes the scoped read return 2 instead of 1.
     */
    @Test
    void theLocalityParameterNarrowsTheSlice() throws Exception {
        User asha = owner("9811100008");
        Property mine = listing(asha, "In the fixture locality", PropertyStatus.APPROVED);
        mine.setOwnerVerified(true);
        properties.saveAndFlush(mine);
        listingIn(asha, "Somewhere else entirely", PropertyStatus.APPROVED, "kothrud");

        mvc.perform(get("/properties/trust-stats").param("locality", SLUG))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListings").value(1))
                .andExpect(jsonPath("$.verifiedListings").value(1));

        mvc.perform(get("/properties/trust-stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListings").value(greaterThan(1)));
    }
}
