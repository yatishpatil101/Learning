package com.draazy.api.catalog;

import com.draazy.api.support.AbstractApiTest;

import static org.assertj.core.api.Assertions.assertThat;
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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Catalogue-wide and the seeded catalogue is shared, so every test asserts growth from a baseline read, never an absolute total. */
class TrustStatsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ObjectMapper objectMapper;

    /** A slug no seed uses, so the fixture listings are the only ones in it. */
    private static final String SLUG = "trust-tally-fixture";

    /** {@code properties.locality_slug} is a foreign key to {@code localities}; rolled back with the test. */
    @BeforeEach
    void createFixtureLocality() {
        jdbc.update("insert into localities (slug, name, city) values (?, ?, 'Pune')"
                + " on conflict (slug) do nothing", SLUG, "Trust Stats Fixture");
    }

    private record Tally(long total, long verified, long owners) {
    }

    private Tally tally() throws Exception {
        String json = mvc.perform(get("/bootstrap"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode stats = objectMapper.readTree(json).path("trustStats");
        return new Tally(stats.path("totalListings").asLong(), stats.path("verifiedListings").asLong(),
                stats.path("verifiedOwners").asLong());
    }

    private void assertGrewBy(Tally before, long total, long verified, long owners) throws Exception {
        Tally after = tally();
        assertThat(after.total() - before.total()).as("totalListings").isEqualTo(total);
        assertThat(after.verified() - before.verified()).as("verifiedListings").isEqualTo(verified);
        assertThat(after.owners() - before.owners()).as("verifiedOwners").isEqualTo(owners);
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

    @Test
    void theTrustHeadlineIsPublic() throws Exception {
        mvc.perform(get("/bootstrap"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.trustStats.totalListings").exists())
                .andExpect(jsonPath("$.trustStats.verifiedListings").exists())
                .andExpect(jsonPath("$.trustStats.verifiedOwners").exists());
    }

    /** Four listings, one live: growth of 4 means the moderation predicate was dropped. */
    @Test
    void onlyApprovedAndUnarchivedListingsAreCounted() throws Exception {
        Tally before = tally();
        User asha = owner("9811100001");
        listing(asha, "Live flat", PropertyStatus.APPROVED);
        listing(asha, "Pending flat", PropertyStatus.PENDING);
        listing(asha, "Rejected flat", PropertyStatus.REJECTED);
        Property gone = listing(asha, "Archived flat", PropertyStatus.APPROVED);
        gone.archive("owner withdrew");
        properties.saveAndFlush(gone);

        assertGrewBy(before, 1, 0, 0);
    }

    /** Owner-verified, ownership-verified and both make three; 4 means the clauses were summed instead of or'd. */
    @Test
    void eitherBadgeCountsAndBothTogetherCountOnce() throws Exception {
        Tally before = tally();
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

        assertGrewBy(before, 3, 3, 1);
    }

    /** An expired verdict does not count: {@code isOwnershipVerified()} lapses with no row write, so the column stays {@code true}. */
    @Test
    void anExpiredOwnershipVerdictDoesNotCountBecauseTheBadgeIsGone() throws Exception {
        Tally before = tally();
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

        assertGrewBy(before, 3, 2, 0);
    }

    /** One owner with three verified listings is one verified owner; counting rows would give 4. */
    @Test
    void verifiedOwnersCountsPeopleNotListings() throws Exception {
        Tally before = tally();
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

        assertGrewBy(before, 4, 4, 2);
    }

    /** A verified deed says nothing about the person, so it must not lend its owner the stronger wording. */
    @Test
    void aVerifiedDeedDoesNotMakeItsOwnerAVerifiedPerson() throws Exception {
        Tally before = tally();
        User asha = owner("9811100006");
        Property p = listing(asha, "Deed but no ID", PropertyStatus.APPROVED);
        p.verifyOwnership(Instant.now(), null);
        properties.saveAndFlush(p);

        assertGrewBy(before, 1, 1, 0);
    }

    /** All three numbers share one live predicate, else a catalogue could report more owners than listings. */
    @Test
    void aVerifiedOwnerWithNothingLiveIsNotCounted() throws Exception {
        Tally before = tally();
        User asha = owner("9811100007");
        Property pending = listing(asha, "Awaiting moderation", PropertyStatus.PENDING);
        pending.setOwnerVerified(true);
        properties.saveAndFlush(pending);

        assertGrewBy(before, 0, 0, 0);
    }

    @Test
    void listingsInEveryLocalityAreCounted() throws Exception {
        Tally before = tally();
        User asha = owner("9811100008");
        Property mine = listing(asha, "In the fixture locality", PropertyStatus.APPROVED);
        mine.setOwnerVerified(true);
        properties.saveAndFlush(mine);
        listingIn(asha, "Somewhere else entirely", PropertyStatus.APPROVED, "kothrud");

        assertGrewBy(before, 2, 1, 1);
    }
}
