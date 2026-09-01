package com.punenest.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.support.AbstractApiTest;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The anti-staleness heartbeat: {@code POST /me/listings/{id}/confirm-available} (V86).
 *
 * <p>The freshness badge is derived from one stored instant, so almost everything worth asserting
 * here is about what the write does <em>not</em> touch. Confirming availability is the single
 * most-repeated owner action the platform asks for, and every plausible "while we're here" —
 * re-moderate it, clear the re-check, bring it back from the archive — turns answering a nudge into
 * a way for an owner to hurt themselves or to dismiss a moderator. Each of those is a case below.
 *
 * <p>The positive cases pin the two halves the feature exists for: the instant is persisted (so it
 * survives the browser that produced it, which is the defect this replaces) and it is visible to a
 * stranger reading the public listing (so the badge means something to the buyer it is shown to).
 *
 * <p>Fixtures: owners created inline; listings created approved via the repository.
 */
@DisplayName("Listings — the owner confirms a listing is still available")
class ListingConfirmAvailableTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Freshness Owner");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property approvedListing(User owner) {
        Property p = new Property(owner, "Bright 2BHK", "rent", "apartment",
                25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }

    private String confirmPath(Property p) {
        return "/me/listings/" + p.getId() + "/confirm-available";
    }

    @Test
    @DisplayName("a fresh listing has never been confirmed, and says so rather than guessing")
    void neverConfirmedReadsAsNull() throws Exception {
        User o = owner("9876500101");
        Property p = approvedListing(o);

        mvc.perform(get("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lastConfirmedAt").doesNotExist());
    }

    @Test
    @DisplayName("confirming stamps the instant and returns the listing carrying it")
    void confirmingStampsTheInstant() throws Exception {
        User o = owner("9876500102");
        Property p = approvedListing(o);
        Instant before = Instant.now().minus(1, ChronoUnit.MINUTES);

        mvc.perform(post(confirmPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lastConfirmedAt").exists());

        Property saved = properties.findById(p.getId()).orElseThrow();
        assertThat(saved.getLastConfirmedAt())
                .as("the confirmation must outlive the browser that made it — storing it per-device "
                        + "is the whole defect this replaces")
                .isNotNull()
                .isAfter(before);
    }

    @Test
    @DisplayName("the buyer reading the public listing sees the same confirmation")
    void theConfirmationIsVisibleToStrangers() throws Exception {
        User o = owner("9876500103");
        Property p = approvedListing(o);

        mvc.perform(post(confirmPath(p)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk());

        // No auth header: the freshness badge is a transparency signal and a signal only the owner
        // can see is not one.
        mvc.perform(get("/properties/" + p.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lastConfirmedAt").exists());
    }

    @Test
    @DisplayName("confirming does not send an approved listing back for moderation")
    void confirmingDoesNotRevertStatus() throws Exception {
        User o = owner("9876500104");
        Property p = approvedListing(o);

        mvc.perform(post(confirmPath(p)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                // The one that would make the nudge self-defeating: an owner answering "still
                // available" would take their own listing out of search to do it.
                .andExpect(jsonPath("$.status").value("approved"));
    }

    @Test
    @DisplayName("confirming does not clear a moderator's pending re-check")
    void confirmingDoesNotClearARecheck() throws Exception {
        User o = owner("9876500105");
        Property p = approvedListing(o);

        // A price edit is the stays-live half of Q14: still approved, but queued for a moderator.
        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":31000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recheckPending").value(true));

        mvc.perform(post(confirmPath(p)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                // Otherwise any owner could dismiss their own re-check with one tap, which is the
                // cheapest way to get an unreviewed price back in front of buyers.
                .andExpect(jsonPath("$.recheckPending").value(true));
    }

    @Test
    @DisplayName("confirming is idempotent — the second tap is not an error")
    void confirmingTwiceIsAllowed() throws Exception {
        User o = owner("9876500106");
        Property p = approvedListing(o);

        mvc.perform(post(confirmPath(p)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk());
        // "Confirm all" on the dashboard sweeps every listing the owner has, and the owner cannot
        // see which ones the badge already considers fresh.
        mvc.perform(post(confirmPath(p)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lastConfirmedAt").exists());
    }

    @Test
    @DisplayName("somebody else's listing is not found, not forbidden")
    void anotherOwnersListingIsNotFound() throws Exception {
        User mine = owner("9876500107");
        User theirs = owner("9876500108");
        Property p = approvedListing(theirs);

        // 404 rather than 403 throughout /me/listings: existence is never confirmed to a caller who
        // does not own the row.
        mvc.perform(post(confirmPath(p)).header(HttpHeaders.AUTHORIZATION, bearer(mine)))
                .andExpect(status().isNotFound());

        assertThat(properties.findById(p.getId()).orElseThrow().getLastConfirmedAt())
                .as("a rejected confirmation must not have written anything")
                .isNull();
    }

    @Test
    @DisplayName("an anonymous caller cannot confirm anything")
    void anonymousCallersAreRejected() throws Exception {
        User o = owner("9876500109");
        Property p = approvedListing(o);

        mvc.perform(post(confirmPath(p)))
                .andExpect(status().isUnauthorized());
    }
}
