package com.draazy.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.engagement.review.Review;
import com.draazy.api.engagement.review.ReviewRepository;
import com.draazy.api.engagement.review.ReviewStatuses;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/** {@code GET /admin/reviews}: reviews publish on write, so moderators could only act on ids they already had. */
@DisplayName("Moderation — the review queue is reachable")
class ReviewModerationQueueTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    ReviewRepository reviews;
    @Autowired
    PropertyRepository properties;

    /** Audit rows commit through REQUIRES_NEW, so the rollback does not take them with it. */
    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        jdbc.update("delete from audit_log where entity = 'review'");
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Reviewer " + mobile);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        if ("staff".equals(role)) {
            jdbc.update("""
                    INSERT INTO back_office_permissions (user_id, permissions)
                    VALUES (?::uuid, ?::jsonb)
                    ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                    """, saved.getId().toString(),
                    "[\"kyc\",\"propertyVerification\",\"listingModeration\",\"reviews\",\"support\",\"content\",\"reports\",\"desk:rental\"]");
        }
        return saved;
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

    @Test
    @DisplayName("a manager reads the queue like staff do")
    void managersSeeTheQueue() throws Exception {
        User author = user("9840000030", "buyer");
        User manager = user("9840000031", "manager");
        review(author.getId(), ReviewStatuses.PUBLISHED);

        mvc.perform(get("/admin/reviews").header(HttpHeaders.AUTHORIZATION, bearer(manager)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    /** "What have we taken down": otherwise nothing on the platform can confirm a rejection happened. */
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

    /** The find-then-take-down loop end to end; each endpoint alone is not a moderation system. */
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

    @Test
    @DisplayName("queue rows are slim, counts=true totals every status, and q matches the author or text")
    void slimRowsCountsAndSearch() throws Exception {
        User author = user("9840000020", "buyer");
        User staff = user("9840000021", "staff");
        review(author.getId(), ReviewStatuses.PUBLISHED);
        review(author.getId(), ReviewStatuses.REJECTED);

        mvc.perform(get("/admin/reviews").param("counts", "true").param("q", "reviewer 9840000020")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].author").value("Reviewer 9840000020"))
                .andExpect(jsonPath("$.content[0].body").exists())
                .andExpect(jsonPath("$.content[0].title").doesNotExist())
                .andExpect(jsonPath("$.content[0].categories").doesNotExist())
                .andExpect(jsonPath("$.content[0].recommend").doesNotExist())
                .andExpect(jsonPath("$.counts.all").value(Matchers.greaterThanOrEqualTo(2)))
                .andExpect(jsonPath("$.counts.rejected").value(Matchers.greaterThanOrEqualTo(1)))
                .andExpect(jsonPath("$.counts.pending").isNumber());

        mvc.perform(get("/admin/reviews").param("q", "no-such-text-anywhere")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.counts").doesNotExist());
    }

    /** Rows carry their status: without it an unfiltered queue mixes live and rejected reviews indistinguishably.
     * Uses {@code Matchers.contains} since a JSONPath filter yields an array even for one element. */
    @Test
    @DisplayName("every queue row carries its moderation status, so the unfiltered queue is usable")
    void queueRowsCarryTheirStatus() throws Exception {
        User author = user("9840000008", "buyer");
        User staff = user("9840000009", "staff");
        Review live = review(author.getId(), ReviewStatuses.PUBLISHED);
        Review taken = review(author.getId(), ReviewStatuses.REJECTED);

        mvc.perform(get("/admin/reviews").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id=='" + live.getId() + "')].status")
                        .value(Matchers.contains(ReviewStatuses.PUBLISHED)))
                .andExpect(jsonPath("$.content[?(@.id=='" + taken.getId() + "')].status")
                        .value(Matchers.contains(ReviewStatuses.REJECTED)));
    }

    /** No public read carries {@code status}: it is constant there, and a constant field invites client branches
     * that never run. Absent (NON_NULL), not null, so the response shape doesn't advertise a withheld field. */
    @Test
    @DisplayName("the public property read does not carry status — it would be a constant there")
    void publicReadsOmitStatus() throws Exception {
        User author = user("9840000010", "buyer");
        User owner = user("9840000011", "buyer");
        Property p = new Property(owner, "2BHK in Baner", "rent", "apartment", 24000L,
                "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        p.setStatus(PropertyStatus.APPROVED);
        properties.saveAndFlush(p);

        Review r = new Review("property", p.getId().toString(), author.getId(), 4);
        r.setBody("Perfectly ordinary flat, landlord responsive.");
        r.setStatus(ReviewStatuses.PUBLISHED);
        reviews.saveAndFlush(r);

        mvc.perform(get("/properties/" + p.getId() + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id=='" + r.getId() + "')].rating")
                        .value(Matchers.contains(4)))
                .andExpect(jsonPath("$.content[?(@.id=='" + r.getId() + "')].status")
                        .value(Matchers.empty()));
    }
}
