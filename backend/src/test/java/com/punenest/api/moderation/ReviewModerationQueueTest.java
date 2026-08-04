package com.punenest.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.engagement.review.Review;
import com.punenest.api.engagement.review.ReviewRepository;
import com.punenest.api.engagement.review.ReviewStatuses;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * {@code GET /admin/reviews} — the queue that {@code PATCH /reviews/{id}/status} needed.
 *
 * <p>Moderation could take a review down but had no way to find one: reviews are post-moderated, so
 * they are published on write, and every other read filters to {@code published}. A moderator could
 * act only on a review whose id they already had — in practice only reported ones. Anything nobody
 * reported was unreachable, and so was the result of any decision already taken, since a rejected
 * review disappears from every public read including this one's only alternative.
 */
@DisplayName("Moderation — the review queue is reachable")
class ReviewModerationQueueTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    ReviewRepository reviews;

    /** Audit rows commit through REQUIRES_NEW, so the rollback does not take them with it. */
    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        jdbc.update("delete from audit_log where entity = 'review'");
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Reviewer " + mobile);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Review review(UUID authorId, String status) {
        Review r = new Review("property", UUID.randomUUID().toString(), authorId, 4);
        r.setBody("Perfectly ordinary flat, landlord responsive.");
        r.setStatus(status);
        return reviews.saveAndFlush(r);
    }

    @Test
    @DisplayName("staff see the whole queue, paged")
    void staffSeeEveryStatus() throws Exception {
        User author = user("9840000001", "buyer");
        User staff = user("9840000002", "staff");
        review(author.getId(), ReviewStatuses.PUBLISHED);
        review(author.getId(), ReviewStatuses.REJECTED);

        mvc.perform(get("/admin/reviews").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray())
                .andExpect(jsonPath("$.totalElements").value(2));
    }

    /**
     * The filter that makes the queue useful after the fact: "what have we taken down". Without it
     * a rejection is a write with no read anywhere on the platform that can confirm it happened.
     */
    @Test
    @DisplayName("the status filter narrows to one moderation state")
    void statusFilterNarrowsTheQueue() throws Exception {
        User author = user("9840000003", "buyer");
        User staff = user("9840000004", "staff");
        review(author.getId(), ReviewStatuses.PUBLISHED);
        Review taken = review(author.getId(), ReviewStatuses.REJECTED);

        mvc.perform(get("/admin/reviews").param("status", ReviewStatuses.REJECTED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(taken.getId().toString()));
    }

    /** The queue is every review on the platform, so an ordinary account must not reach it. */
    @Test
    @DisplayName("an ordinary user cannot read the queue")
    void seekersAreForbidden() throws Exception {
        User seeker = user("9840000005", "buyer");

        mvc.perform(get("/admin/reviews").header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                .andExpect(status().isForbidden());
    }

    /**
     * The loop the two endpoints now close, asserted end to end: find a review, take it down, and
     * see the decision reflected. Each half existed; only together are they a moderation system.
     */
    @Test
    @DisplayName("a review found in the queue can be taken down and the change is visible there")
    void queueAndDecisionCloseTheLoop() throws Exception {
        User author = user("9840000006", "buyer");
        User staff = user("9840000007", "staff");
        Review r = review(author.getId(), ReviewStatuses.PUBLISHED);

        mvc.perform(patch("/reviews/" + r.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"rejected\",\"reason\":\"defamatory\"}"))
                .andExpect(status().isOk());

        mvc.perform(get("/admin/reviews").param("status", ReviewStatuses.REJECTED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(r.getId().toString()));
    }
}
