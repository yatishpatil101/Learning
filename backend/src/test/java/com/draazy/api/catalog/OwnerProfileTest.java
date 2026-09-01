package com.draazy.api.catalog;

import com.draazy.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * {@code GET /owners/{id}} — the public seller card, and the owner facet on the public search.
 *
 * <p>The profile page was handed the whole user row and rendered five fields out of it. These tests
 * are mostly about the fields that are now <em>not</em> there: a response that carries email or
 * account status is a response somebody will eventually render, and the ceiling is only a ceiling
 * if something fails when it moves.
 *
 * <p>The second half covers {@code /properties?owner=}, which is how the profile gets its listings.
 * It is a facet on the existing search precisely so the approved-and-unarchived floor is the one
 * already there — so the tests that matter are the ones proving that floor still applies when the
 * caller is asking for one person's stock.
 */
class OwnerProfileTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    EntityManager em;

    /** A slug no seed uses, so each test owns its slice of the catalogue outright. */
    private static final String SLUG = "owner-profile-fixture";

    /** Same reason as the trust-stats fixture: {@code locality_slug} is a foreign key. */
    @BeforeEach
    void createFixtureLocality() {
        jdbc.update("insert into localities (slug, name, city) values (?, ?, 'Pune')"
                + " on conflict (slug) do nothing", SLUG, "Owner Profile Fixture");
    }

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title, String status) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setLocalitySlug(SLUG);
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    // ---------------- the card ----------------

    /**
     * The card is public, and it is the shape it claims to be.
     *
     * <p>The four identity fields plus the two a profile adds. Asserted as a whole rather than one
     * key at a time because the interesting failure is an <em>extra</em> field, which no
     * single-key assertion can see.
     */
    @Test
    void theSellerCardIsPublicAndCappedToSixFields() throws Exception {
        User u = owner("9811000001");
        mvc.perform(get("/owners/" + u.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(u.getId().toString()))
                .andExpect(jsonPath("$.name").value("Asha Patil"))
                .andExpect(jsonPath("$.mobile").exists())
                .andExpect(jsonPath("$.verified").exists())
                .andExpect(jsonPath("$.listingCount").exists())
                .andExpect(jsonPath("$.*", org.hamcrest.Matchers.hasSize(7)));
    }

    /**
     * Nothing operational escapes.
     *
     * <p>These are the fields the old spread carried, named one by one on purpose: a test that only
     * counted keys would go green again the moment somebody swapped one absent field for another.
     *
     * <p>{@code lastActive} is in the list for a different reason from the rest. It is not sensitive
     * in the way an email is — it is worse, because a public page that shows it turns into a
     * presence indicator for a private individual who never agreed to publish one.
     */
    @Test
    void theCardCarriesNothingOperationalAboutTheAccount() throws Exception {
        User u = owner("9811000002");
        u.setEmail("asha@example.com");
        users.saveAndFlush(u);

        mvc.perform(get("/owners/" + u.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").doesNotExist())
                .andExpect(jsonPath("$.role").doesNotExist())
                .andExpect(jsonPath("$.status").doesNotExist())
                .andExpect(jsonPath("$.team").doesNotExist())
                .andExpect(jsonPath("$.lastActive").doesNotExist())
                .andExpect(jsonPath("$.flagged").doesNotExist())
                .andExpect(jsonPath("$.aadhaarVerified").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist());
    }

    /**
     * The mobile is masked, unconditionally.
     *
     * <p>Both directions in one test: the masked form is present <em>and</em> the raw number is
     * absent. Asserting only the first would pass against a response that helpfully included both.
     *
     * <p>There is no reveal path here at all, which is the fix rather than a gap: the old page
     * revealed the number to anyone holding an approved contact request against any one of this
     * owner's listings, turning a per-listing grant into a per-person one.
     */
    @Test
    void theMobileIsMaskedWithNoWayToRevealIt() throws Exception {
        User u = owner("9811000003");
        mvc.perform(get("/owners/" + u.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mobile").value("98XXXXX003"))
                .andExpect(jsonPath("$.mobile").value(org.hamcrest.Matchers.not("9811000003")));
    }

    /**
     * "Member since" is a year, not a timestamp.
     *
     * <p>The page renders four characters; sending the instant would publish the minute somebody
     * signed up, which is a correlation handle the reader gains nothing from.
     *
     * <p>Read in IST rather than the server's zone: an account created at 04:00 IST on 1 January is
     * still the previous year in UTC, and the profile would then disagree with the confirmation
     * email the same person received.
     * <p>Written through JDBC because {@code joined_at} is {@code updatable = false} — it is set
     * once at signup and the entity deliberately offers no way to move it. The persistence context
     * is cleared afterwards, without which the assertion would read the freshly-saved entity out of
     * the first-level cache and never see the row the test actually wrote.
     */
    @Test
    void memberSinceIsTheYearReadInIndianTime() throws Exception {
        User u = owner("9811000004");
        Instant justAfterMidnightIst = Instant.parse("2023-12-31T19:00:00Z"); // 00:30 IST, 1 Jan 2024
        jdbc.update("update users set joined_at = ? where id = ?",
                java.sql.Timestamp.from(justAfterMidnightIst), u.getId());
        em.clear();

        mvc.perform(get("/owners/" + u.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memberSince").value(2024))
                .andExpect(jsonPath("$.memberSince")
                        .value(org.hamcrest.Matchers.not(justAfterMidnightIst.atZone(ZoneId.of("UTC")).getYear())));
    }

    /**
     * The listing count is the live one, not {@code users.listings_count}.
     *
     * <p>Three listings, one of them live. The stored column would say three; the page means one,
     * because one is what a visitor can open. The two disagree the moment anything is taken down,
     * which is why the column is not read.
     */
    @Test
    void theListingCountCountsOnlyWhatAVisitorCanOpen() throws Exception {
        User u = owner("9811000005");
        listing(u, "Live one", PropertyStatus.APPROVED);
        listing(u, "Still pending", "pending");
        Property archived = listing(u, "Taken down", PropertyStatus.APPROVED);
        archived.archive("rented out");
        properties.saveAndFlush(archived);

        mvc.perform(get("/owners/" + u.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listingCount").value(1));
    }

    /** An owner with nothing live is a real owner with a real answer, not a 404. */
    @Test
    void anOwnerWithNoLiveListingsAnswersZero() throws Exception {
        User u = owner("9811000006");
        mvc.perform(get("/owners/" + u.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listingCount").value(0));
    }

    // ---------------- what is not reachable ----------------

    /**
     * An unknown id, a malformed one, and an archived account all answer the same 404.
     *
     * <p>All three in one test because the claim is precisely that they are indistinguishable. A
     * malformed id answering {@code 400} would tell an enumerator their guess was badly formatted
     * rather than wrong, and an archived account answering anything but 404 would leave a
     * soft-deleted person reachable at a stable public URL — which is the difference between
     * deleting an account and merely hiding it.
     */
    @Test
    void unknownMalformedAndArchivedOwnersAreAllTheSameNotFound() throws Exception {
        mvc.perform(get("/owners/" + UUID.randomUUID())).andExpect(status().isNotFound());
        mvc.perform(get("/owners/not-a-uuid-at-all")).andExpect(status().isNotFound());

        User u = owner("9811000007");
        u.archive("account closed");
        users.saveAndFlush(u);
        mvc.perform(get("/owners/" + u.getId())).andExpect(status().isNotFound());
    }

    /**
     * There is no public collection read.
     *
     * <p>{@code GET /owners} would be a downloadable directory of the platform's landlords, worth
     * far more to a scraper than to any visitor. No handler is mapped, and the security chain's
     * matcher is single-segment so nothing deeper is public either.
     */
    @Test
    void thereIsNoPublicListOfOwners() throws Exception {
        mvc.perform(get("/owners")).andExpect(status().is4xxClientError());
    }

    // ---------------- the owner facet on search ----------------

    /**
     * {@code /properties?owner=} returns that owner's live stock and nobody else's.
     *
     * <p>Both directions: the owner's own listing is present and another owner's is absent. Only
     * asserting the first would pass against a facet that was silently ignored.
     */
    @Test
    void theOwnerFacetNarrowsToOnePerson() throws Exception {
        User mine = owner("9811000008");
        User theirs = owner("9811000009");
        listing(mine, "Mine and live", PropertyStatus.APPROVED);
        listing(theirs, "Theirs and live", PropertyStatus.APPROVED);

        mvc.perform(get("/properties").param("owner", mine.getId().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].title",
                        org.hamcrest.Matchers.hasItem("Mine and live")))
                .andExpect(jsonPath("$.content[*].title",
                        org.hamcrest.Matchers.not(org.hamcrest.Matchers.hasItem("Theirs and live"))));
    }

    /**
     * The facet does not lift the public floor.
     *
     * <p>This is the whole reason the owner's listings are a search facet rather than a nested array
     * on the profile: a bespoke {@code /owners/{id}/listings} would be a second place to remember
     * that pending and archived rows are not public, and second places are where that gets
     * forgotten. Asked for by title, because "the count is 1" would also pass if the facet returned
     * the wrong single row.
     */
    @Test
    void askingForOneOwnersStockStillHidesWhatIsNotPublic() throws Exception {
        User u = owner("9811000010");
        listing(u, "Owner facet live", PropertyStatus.APPROVED);
        listing(u, "Owner facet pending", "pending");
        Property archived = listing(u, "Owner facet archived", PropertyStatus.APPROVED);
        archived.archive("rented out");
        properties.saveAndFlush(archived);

        mvc.perform(get("/properties").param("owner", u.getId().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", org.hamcrest.Matchers.hasSize(1)))
                .andExpect(jsonPath("$.content[0].title").value("Owner facet live"));
    }

    /**
     * A malformed owner id is an empty page, not a 500.
     *
     * <p>The facet joins through the association, so the value is compared as a UUID by the driver
     * rather than cast in SQL. A caller pasting a mock id into the query string is asking for a
     * person who does not exist, and an empty result is the honest answer to that.
     */
    @Test
    void aMalformedOwnerFacetMatchesNothingRatherThanFailing() throws Exception {
        mvc.perform(get("/properties").param("owner", "u1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", org.hamcrest.Matchers.hasSize(0)));
    }
}
