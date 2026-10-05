package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

// The managed owner dirty-check write is load-bearing;
// a detached owner silently drops the tally.
@DisplayName("Listings count — the column that used to have no writer")
class ListingCountTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired EntityManager em;

    private static final String BODY = """
            {"title":"%s","deal":"rent","propertyType":"apartment","price":25000,
             "locality":"Kothrud","city":"Pune",%s}
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
                        .content(BODY.formatted(title, listingImages(o))))
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

    // Across an archive, the count still climbs to 2:
    // it is a lifetime tally, not a live-listing boolean.
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

    // The role stays `buyer`, and that is the point of the whole change.
    // Posting must not promote a buyer; account creation is the only role writer.
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
