package com.draazy.api.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/**
 * The freemium listing ceiling, enforced where it can actually be enforced.
 *
 * <p><strong>What this replaced was not a weaker gate; it was no gate.</strong> The wizard compared
 * a count of the listings <em>that browser's</em> {@code localStorage} held against a ceiling the
 * same browser computed from a referral tally it had minted for itself. An owner who posted from a
 * laptop and then opened the wizard on a phone was measured as having posted nothing and waved
 * straight past their limit — so the free tier was, in practice, a paywall against clearing your
 * cookies. Both numbers now come from the server, but a number a client reads is a number a client
 * can skip, and {@code POST /me/listings} is reachable without the wizard at all.
 *
 * <p>The properties worth proving here are the edges, not the happy path:
 *
 * <ol>
 *   <li><strong>The ceiling binds across devices</strong>, because it is counted from the
 *       catalogue rather than from the caller.</li>
 *   <li><strong>Archiving frees the slot.</strong> The free tier is one listing at a time, not one
 *       listing ever — otherwise an owner who sells their flat can never list the next one, and the
 *       only remedy for a typo is to pay.</li>
 *   <li><strong>A rejection costs nothing.</strong> A listing moderation refused occupies nothing
 *       the owner can use; charging a slot for it would let a moderator permanently spend a
 *       free-tier owner's entire allowance.</li>
 *   <li><strong>A refused post writes nothing.</strong> The check runs before the row is built, so
 *       there is no half-created listing and no duplicate-probe entry left behind.</li>
 * </ol>
 */
@DisplayName("Listing quota — the ceiling the browser used to keep")
class ListingQuotaTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    private static final String BODY = """
            {"title":"%s","deal":"rent","propertyType":"apartment","price":25000,
             "locality":"Kothrud","city":"Pune"}
            """;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Quota " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /**
     * A listing already in the catalogue, saved directly.
     *
     * <p>Deliberately not posted through the endpoint: the point of these tests is that the count
     * comes from the catalogue and not from the caller's session, so the fixture has to arrive by a
     * route the caller's browser was never part of. That is also what "posted from another device"
     * means here.
     */
    private Property existing(User owner, String title, String status) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    private int tryPost(User owner, String title) throws Exception {
        return mvc.perform(post("/me/listings").header("Authorization", bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY.formatted(title)))
                .andReturn().getResponse().getStatus();
    }

    @Test
    @DisplayName("the first listing is free and the second is refused, on a browser that posted neither")
    void theFreeTierIsOneListingAtATime() throws Exception {
        User o = owner("9861000001");
        existing(o, "Posted from the laptop", PropertyStatus.APPROVED);

        mvc.perform(post("/me/listings").header("Authorization", bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY.formatted("Posted from the phone")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("listing_quota_exhausted"))
                // The message has to name both numbers. "You are over your limit" sends an owner
                // to support; "1 of 1" sends them to the listing they forgot they had.
                .andExpect(jsonPath("$.message").value(containsString("1 of 1")));
    }

    @Test
    @DisplayName("a listing still in the moderation queue holds its slot")
    void pendingCountsTowardsTheCeiling() throws Exception {
        User o = owner("9861000002");
        existing(o, "Awaiting review", PropertyStatus.PENDING);

        assertThat(tryPost(o, "And another")).isEqualTo(422);
    }

    @Test
    @DisplayName("a rejected listing costs nothing — a moderator cannot spend an owner's allowance")
    void rejectedDoesNotCountTowardsTheCeiling() throws Exception {
        User o = owner("9861000003");
        existing(o, "Turned down", PropertyStatus.REJECTED);

        assertThat(tryPost(o, "Second attempt")).isEqualTo(201);
    }

    @Test
    @DisplayName("taking a listing down frees the slot")
    void archivingReturnsTheSlot() throws Exception {
        User o = owner("9861000004");
        Property first = existing(o, "The old flat", PropertyStatus.APPROVED);

        assertThat(tryPost(o, "The new flat")).isEqualTo(422);

        mvc.perform(delete("/me/listings/" + first.getId())
                        .header("Authorization", bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(true));

        assertThat(tryPost(o, "The new flat")).isEqualTo(201);
    }

    @Test
    @DisplayName("a refused post leaves nothing behind")
    void aRefusedPostIsNotAHalfWrittenListing() throws Exception {
        User o = owner("9861000005");
        existing(o, "The only one", PropertyStatus.APPROVED);

        assertThat(tryPost(o, "Never created")).isEqualTo(422);
        assertThat(properties.findAll().stream().map(Property::getTitle))
                .doesNotContain("Never created");
    }

    @Test
    @DisplayName("taking down someone else's listing is a 404, not a 403")
    void takeDownIsOwnerScoped() throws Exception {
        User mine = owner("9861000006");
        User theirs = owner("9861000007");
        Property p = existing(theirs, "Not yours", PropertyStatus.APPROVED);

        mvc.perform(delete("/me/listings/" + p.getId()).header("Authorization", bearer(mine)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("taking down twice is not an error — the caller asked for a state, not an event")
    void takeDownIsIdempotent() throws Exception {
        User o = owner("9861000008");
        Property p = existing(o, "Gone", PropertyStatus.APPROVED);

        mvc.perform(delete("/me/listings/" + p.getId()).header("Authorization", bearer(o)))
                .andExpect(status().isOk());
        mvc.perform(delete("/me/listings/" + p.getId()).header("Authorization", bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(true));
    }
}
