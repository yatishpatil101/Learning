package com.draazy.api.moderation;

import com.draazy.api.support.AbstractApiTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.engagement.review.Review;
import com.draazy.api.engagement.review.ReviewRepository;
import com.draazy.api.engagement.review.ReviewStatuses;
import com.draazy.api.engagement.review.ReviewTargetTypes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/**
 * The D9.7 invariant: <strong>rejecting a review removes it from the page <em>and</em> from the
 * score it moved, in one write.</strong>
 *
 * <p>This is the whole reason review takedown needed no new column, and it is worth a test because
 * the failure mode is silent. If the rating aggregate ever stopped filtering on
 * {@code status = 'published'} — a one-word change in {@code ReviewRepository.aggregateFor} — a
 * defamatory review would vanish from the listing while still dragging the society's rating down,
 * and nothing in the UI would show that anything was wrong. Moderators would see the review gone,
 * consider the complaint handled, and the harm would persist under a number no one re-checks.
 *
 * <p>So the assertions deliberately bracket the takedown: the same two reads are made before and
 * after, and both must move together. Asserting only that the review disappeared from the list
 * would pass against exactly the bug this exists to catch.
 */
@DisplayName("Review takedown — the page and the score move together")
class ReviewTakedownTest extends AbstractApiTest {

    /** Seeded by {@code R__DML_seed_reference_data.sql}; addressable by slug per {@code ReviewTargetKey}. */
    private static final String SOCIETY_SLUG = "skyline-heights-baner";

    @Autowired
    UserRepository users;
    @Autowired
    ReviewRepository reviews;

    /** Audit writes are {@code REQUIRES_NEW}, so they outlive this test's rollback — see below. */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Reviewer " + mobile);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Review review(UUID societyId, UUID authorId, int rating) {
        Review r = new Review(ReviewTargetTypes.SOCIETY, societyId.toString(), authorId, rating);
        r.setBody("rating " + rating);
        return reviews.saveAndFlush(r);
    }

    private UUID societyId() {
        return jdbc.queryForObject("select id from societies where slug = ?", UUID.class, SOCIETY_SLUG);
    }

    @Test
    @DisplayName("a rejected review leaves the public list and the rating aggregate together")
    void rejectionRemovesTheReviewFromBothThePageAndTheScore() throws Exception {
        UUID society = societyId();
        User glowing = user("9810000401", Roles.Wire.BUYER);
        User damaging = user("9810000402", Roles.Wire.BUYER);
        User staff = user("9810000403", Roles.Wire.STAFF);
        String staffToken = "Bearer " + jwtService.issueAccessToken(staff);

        review(society, glowing.getId(), 5);
        Review toReject = review(society, damaging.getId(), 1);

        // Before: both reviews are public, and both are in the average.
        mvc.perform(get("/reviews/society/" + SOCIETY_SLUG))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2));
        mvc.perform(get("/societies/" + SOCIETY_SLUG))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reviewCount").value(2))
                .andExpect(jsonPath("$.avgRating").value(3.0));

        mvc.perform(patch("/reviews/" + toReject.getId() + "/status")
                .header("Authorization", staffToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"rejected\",\"reason\":\"defamatory\"}"))
                .andExpect(status().isOk());

        // After: gone from the page AND gone from the score. Either one alone is not a takedown.
        mvc.perform(get("/reviews/society/" + SOCIETY_SLUG))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/societies/" + SOCIETY_SLUG))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reviewCount").value(1))
                .andExpect(jsonPath("$.avgRating").value(5.0));

        // The row is still there. A takedown is a state change, not a delete: the report that
        // triggered it, and the audit entry naming the moderator, both point at this id.
        assertThat(reviews.findById(toReject.getId()))
                .get()
                .extracting(Review::getStatus)
                .isEqualTo(ReviewStatuses.REJECTED);
    }

    @Test
    @DisplayName("only publish and reject are settable — pending is intake, not a decision")
    void anArbitraryStatusIsRefused() throws Exception {
        UUID society = societyId();
        User author = user("9810000404", Roles.Wire.BUYER);
        User staff = user("9810000405", Roles.Wire.STAFF);
        Review r = review(society, author.getId(), 4);

        mvc.perform(patch("/reviews/" + r.getId() + "/status")
                .header("Authorization", "Bearer " + jwtService.issueAccessToken(staff))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"deleted\"}"))
                .andExpect(status().isBadRequest());

        assertThat(reviews.findById(r.getId())).get()
                .extracting(Review::getStatus).isEqualTo(ReviewStatuses.PUBLISHED);
    }

    @Test
    @DisplayName("an unknown review id is 404, and a malformed one is too")
    void unknownAndMalformedIdsBothLookTheSame() throws Exception {
        String token = "Bearer " + jwtService.issueAccessToken(user("9810000406", Roles.Wire.STAFF));
        String body = "{\"status\":\"rejected\"}";

        mvc.perform(patch("/reviews/" + UUID.randomUUID() + "/status")
                .header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNotFound());

        mvc.perform(patch("/reviews/not-a-uuid/status")
                .header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNotFound());
    }
}
