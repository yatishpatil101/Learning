package com.draazy.api.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

// The quota is enforced server-side because browser localStorage counted only
// that device and `POST /me/listings` is reachable without the wizard.
@DisplayName("Listing quota — the ceiling the browser used to keep")
class ListingQuotaTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    private static final String BODY = """
            {"title":"%s","deal":"rent","propertyType":"apartment","price":25000,
             "locality":"Kothrud","city":"Pune",%s}
            """;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Quota " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    // A listing already in the catalogue, saved directly.
    // That is also what "posted from another device" means here.
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
                        .content(BODY.formatted(title, listingImages(owner))))
                .andReturn().getResponse().getStatus();
    }

    @Test
    @DisplayName("the first listing is free and the second is refused, on a browser that posted neither")
    void theFreeTierIsOneListingAtATime() throws Exception {
        User o = owner("9861000001");
        existing(o, "Posted from the laptop", PropertyStatus.APPROVED);

        mvc.perform(post("/me/listings").header("Authorization", bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY.formatted("Posted from the phone", listingImages(o))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("listing_quota_exhausted"))

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
    @DisplayName("a paused listing still holds its slot")
    void pausedCountsTowardsTheCeiling() throws Exception {
        User o = owner("9861000009");
        existing(o, "Paused flat", PropertyStatus.PAUSED);

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
    @DisplayName("entitlements report the same held count the gate refuses on")
    void entitlementsReportTheHeldCount() throws Exception {
        User o = owner("9861000010");
        existing(o, "Live", PropertyStatus.APPROVED);
        existing(o, "Queued", PropertyStatus.PENDING);
        existing(o, "Turned down", PropertyStatus.REJECTED);
        Property gone = existing(o, "Taken down", PropertyStatus.APPROVED);
        mvc.perform(delete("/me/listings/" + gone.getId()).header("Authorization", bearer(o)))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Plans.ENTITLEMENTS).header("Authorization", bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listings.used").value(2));
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
    @DisplayName("a fourth post inside a day is refused even though no slot is held")
    void theDailyPaceBindsWhereTheCeilingCannot() throws Exception {
        User o = owner("9861400001");
        for (int i = 0; i < 3; i++) {
            existing(o, "Turned down " + i, PropertyStatus.REJECTED);
        }

        mvc.perform(post("/me/listings").header("Authorization", bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY.formatted("Fourth today", listingImages(o))))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate_limited"))
                .andExpect(jsonPath("$.message").value(containsString("3 new listings a day")));
    }

    @Test
    @DisplayName("deleting listings does not reset the daily pace")
    void deletingDoesNotResetThePace() throws Exception {
        User o = owner("9861400002");
        for (int i = 0; i < 3; i++) {
            mvc.perform(delete("/me/listings/" + existing(o, "Posted and pulled " + i, PropertyStatus.APPROVED).getId())
                            .header("Authorization", bearer(o)))
                    .andExpect(status().isOk());
        }

        assertThat(tryPost(o, "Fourth today")).isEqualTo(429);
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
