package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.support.AbstractApiTest;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// The confirmation instant must persist server-side and appear on public detail,
// or the buyer-facing badge means nothing.
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

    private String pausePath(Property p) {
        return "/me/listings/" + p.getId() + "/pause";
    }

    private String resumePath(Property p) {
        return "/me/listings/" + p.getId() + "/resume";
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
    @DisplayName("confirming stamps the instant, keeps the listing approved, and returns it carrying the stamp")
    void confirmingStampsTheInstant() throws Exception {
        User o = owner("9876500102");
        Property p = approvedListing(o);
        Instant before = Instant.now().minus(1, ChronoUnit.MINUTES);

        mvc.perform(post(confirmPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lastConfirmedAt").exists())
                .andExpect(jsonPath("$.status").value("approved"));

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
    @DisplayName("confirming does not clear a moderator's pending re-check")
    void confirmingDoesNotClearARecheck() throws Exception {
        User o = owner("9876500105");
        Property p = approvedListing(o);

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

        mvc.perform(post(confirmPath(p)).header(HttpHeaders.AUTHORIZATION, bearer(mine)))
                .andExpect(status().isNotFound());

        assertThat(properties.findById(p.getId()).orElseThrow().getLastConfirmedAt())
                .as("a rejected confirmation must not have written anything")
                .isNull();
    }

    @Test
    @DisplayName("an owner can pause a live listing and keep its detail link reachable")
    void ownerCanPauseALiveListing() throws Exception {
        User o = owner("9876500109");
        Property p = approvedListing(o);

        mvc.perform(post(pausePath(p)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("paused"));

        mvc.perform(get("/properties/" + p.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("paused"));
        mvc.perform(get("/properties").param("q", "Bright 2BHK"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    @DisplayName("an owner can resume only their own paused listing")
    void ownerCanResumeAPausedListing() throws Exception {
        User o = owner("9876500110");
        Property p = approvedListing(o);

        mvc.perform(post(pausePath(p)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk());
        mvc.perform(post(resumePath(p)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"));
    }

    @Test
    @DisplayName("a paused evidence edit stays queued after resume")
    void pausedEvidenceEditSurvivesResume() throws Exception {
        User o = owner("9876500113");
        Property p = approvedListing(o);

        mvc.perform(post(pausePath(p)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk());
        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{" + listingImages(o) + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("paused"))
                .andExpect(jsonPath("$.recheckPending").value(true));

        mvc.perform(post(resumePath(p)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(true));
    }

    @Test
    @DisplayName("pause and resume are owner-scoped and state-scoped")
    void pauseAndResumeRejectIllegalTransitions() throws Exception {
        User mine = owner("9876500111");
        User theirs = owner("9876500112");
        Property live = approvedListing(theirs);
        Property pending = approvedListing(mine);
        pending.setStatus(PropertyStatus.PENDING);
        properties.saveAndFlush(pending);

        mvc.perform(post(pausePath(live)).header(HttpHeaders.AUTHORIZATION, bearer(mine)))
                .andExpect(status().isNotFound());
        mvc.perform(post(pausePath(pending)).header(HttpHeaders.AUTHORIZATION, bearer(mine)))
                .andExpect(status().isConflict());
        mvc.perform(post(resumePath(live)).header(HttpHeaders.AUTHORIZATION, bearer(theirs)))
                .andExpect(status().isConflict());
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
