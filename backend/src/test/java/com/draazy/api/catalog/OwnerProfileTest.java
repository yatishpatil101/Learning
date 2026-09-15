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

/** Public seller card at {@code GET /owners/{id}} plus the owner facet on {@code /properties}. */
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

    /** Asserted as a whole to catch an <em>extra</em> field a single-key check would miss. */
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
     * Named individually so a swap of one absent field for another still fails; {@code lastActive}
     * would turn a public profile into a presence indicator for a private individual.
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
                .andExpect(jsonPath("$.identityVerified").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist());
    }

    /** Both directions in one test: the masked form is present <em>and</em> the raw number is absent. */
    @Test
    void theMobileIsMaskedWithNoWayToRevealIt() throws Exception {
        User u = owner("9811000003");
        mvc.perform(get("/owners/" + u.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mobile").value("98XXXXX003"))
                .andExpect(jsonPath("$.mobile").value(org.hamcrest.Matchers.not("9811000003")));
    }

    /**
     * Read in IST so the year agrees with the confirmation email. JDBC-written because
     * {@code joined_at} is not updatable; {@code em.clear()} forces a database read, not a cache hit.
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

    /** The stored {@code listings_count} column disagrees with what a visitor can open the moment anything is taken down. */
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
     * All three collapse to 404: 400 on malformed would be an enumeration oracle, and any other
     * status on the archived owner would keep a soft-deleted person reachable at a stable URL.
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

    /** {@code GET /owners} would be a scraper-grade landlord directory; no handler, no deep public path. */
    @Test
    void thereIsNoPublicListOfOwners() throws Exception {
        mvc.perform(get("/owners")).andExpect(status().is4xxClientError());
    }

    // ---------------- the owner facet on search ----------------

    /** Both directions: only asserting the positive would pass against a facet silently ignored. */
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
     * A facet on the shared search keeps the pending/archived rules in one place. Asked for by
     * title because "count is 1" would also pass against the wrong single row.
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

    /** Driver-side UUID comparison answers empty rather than 500 when the parameter is malformed. */
    @Test
    void aMalformedOwnerFacetMatchesNothingRatherThanFailing() throws Exception {
        mvc.perform(get("/properties").param("owner", "u1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", org.hamcrest.Matchers.hasSize(0)));
    }
}
