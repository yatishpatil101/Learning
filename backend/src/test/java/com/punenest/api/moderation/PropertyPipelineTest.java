package com.punenest.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.PipelineStage;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * {@code POST /properties/{id}/pipeline} — the owner hand-back funnel for staff-posted listings.
 *
 * <p><strong>What the funnel is.</strong> Staff sometimes create a listing for an owner who phoned
 * it in. That listing goes live owned by an account its owner has never signed into, which is a
 * liability with a clock on it, and the funnel is the record of handing it over.
 *
 * <p><strong>Why the stage names here and not the console's.</strong> The admin board shipped
 * {@code contacted, info_collected, listed, docs_submitted, under_review, live}; the column's
 * {@code CHECK} constraint, its partial index and the published contract all say
 * {@code listed, docs_submitted, photos_uploaded, aadhaar_verified, claim_sent, claimed}. Four of
 * the board's six would be refused by Postgres on write. The board was the outlier, and two of its
 * stages could not have worked at all: {@code contacted} and {@code info_collected} describe work
 * done before a listing exists.
 *
 * <p><strong>The visibility tests are the point of the change, not decoration.</strong>
 * {@code adminPipeline} rides on {@code PropertyResponse}, which is also what the public
 * {@code GET /properties/{id}} returns. Without an audience gate, every buyer browsing a listing
 * would be told which listings the platform manufactured rather than received, and which staff
 * member did it.
 */
@DisplayName("D215 — the post-on-behalf hand-back funnel")
class PropertyPipelineTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    @AfterEach
    void clearAudit() {
        // AuditService commits in its own transaction, so its rows outlive this test's rollback.
        jdbc.update("delete from audit_log where action like 'property.pipeline%'");
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Pipeline " + mobile);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, boolean onBehalf, String staffId) {
        Property p = new Property(owner, "Pipeline flat", "rent", "apartment", 31000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("880"));
        p.setStatus(PropertyStatus.APPROVED);
        if (onBehalf) {
            p.markPostedOnBehalf(staffId);
        }
        return properties.saveAndFlush(p);
    }

    private void move(User staff, Property p, String stage, int expectedStatus) throws Exception {
        mvc.perform(post("/properties/" + p.getId() + "/pipeline")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"stage\":\"" + stage + "\"}"))
                .andExpect(status().is(expectedStatus));
    }

    /**
     * The three contract booleans are derived from the stage, so reaching a later stage sets every
     * earlier milestone without anyone writing them.
     *
     * <p>This is the whole reason they are not stored. A row saying {@code claimed} with
     * {@code photosUploaded: false} would be unanswerable — somebody would have to decide which
     * half to believe — and derivation makes that state unrepresentable.
     */
    @Test
    @DisplayName("the milestone flags are derived from the stage, so they cannot contradict it")
    void milestonesFollowTheStage() throws Exception {
        User owner = user("9852000001", "owner");
        User staff = user("9852000002", "staff");
        Property p = listing(owner, true, staff.getId().toString());

        move(staff, p, PipelineStage.PHOTOS_UPLOADED, 200);
        mvc.perform(get("/admin/properties").param("q", "Pipeline flat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].adminPipeline.pipelineStage")
                        .value(PipelineStage.PHOTOS_UPLOADED))
                .andExpect(jsonPath("$.content[0].adminPipeline.photosUploaded").value(true))
                .andExpect(jsonPath("$.content[0].adminPipeline.aadhaarVerified").value(false))
                .andExpect(jsonPath("$.content[0].adminPipeline.claimLinkSent").value(false));

        move(staff, p, PipelineStage.CLAIMED, 200);
        mvc.perform(get("/admin/properties").param("q", "Pipeline flat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.content[0].adminPipeline.photosUploaded").value(true))
                .andExpect(jsonPath("$.content[0].adminPipeline.aadhaarVerified").value(true))
                .andExpect(jsonPath("$.content[0].adminPipeline.claimLinkSent").value(true));
    }

    /**
     * Backwards is allowed, because the stages record what has actually come back from an owner and
     * that can be undone — a document turns out to be the wrong flat, a claim link goes to a stale
     * number. A forward-only funnel leaves the desk no way to say so except to lie.
     */
    @Test
    @DisplayName("a stage can be walked back when evidence is withdrawn")
    void stagesCanGoBackwards() throws Exception {
        User owner = user("9852000003", "owner");
        User staff = user("9852000004", "staff");
        Property p = listing(owner, true, staff.getId().toString());

        move(staff, p, PipelineStage.CLAIM_SENT, 200);
        move(staff, p, PipelineStage.DOCS_SUBMITTED, 200);

        properties.flush();
        // Read the column, not the entity: a cached instance would report the value this test just
        // set regardless of whether the second call reached the database at all.
        assertThat(jdbc.queryForObject(
                "select pipeline_stage from properties where id = ?", String.class, p.getId()))
                .isEqualTo(PipelineStage.DOCS_SUBMITTED);
    }

    /**
     * A listing the owner posted themselves has already arrived where the funnel is trying to get
     * to, so putting it on the board would create an item that can never be cleared.
     */
    @Test
    @DisplayName("a listing its owner posted has no hand-back to track")
    void ownerPostedListingsAreRefused() throws Exception {
        User owner = user("9852000005", "owner");
        User staff = user("9852000006", "staff");
        Property p = listing(owner, false, null);

        move(staff, p, PipelineStage.DOCS_SUBMITTED, 409);
    }

    /** An unknown stage is a client error, not a seventh stage to be silently accepted. */
    @Test
    @DisplayName("the console's own stage names are refused, not stored")
    void unknownStagesAreRejected() throws Exception {
        User owner = user("9852000007", "owner");
        User staff = user("9852000008", "staff");
        Property p = listing(owner, true, staff.getId().toString());

        // `under_review` is one of the four board stages the CHECK constraint would refuse. Caught
        // in Java so the caller gets a sentence naming the six valid stages rather than a 500 from
        // a constraint violation.
        move(staff, p, "under_review", 400);
    }

    /**
     * The audience gate. {@code PropertyResponse} is shared between the moderation queue and the
     * public listing page, so the funnel has to be omitted rather than merely unused by consumers.
     */
    @Test
    @DisplayName("a buyer reading the listing is not told the platform posted it")
    void consumersNeverSeeTheFunnel() throws Exception {
        User owner = user("9852000009", "owner");
        User staff = user("9852000010", "staff");
        User buyer = user("9852000011", "buyer");
        Property p = listing(owner, true, staff.getId().toString());

        mvc.perform(get("/properties/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.adminPipeline").doesNotExist());

        // And the owner cannot see it either: it names a colleague and describes internal chasing.
        mvc.perform(get("/me/listings")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].adminPipeline").doesNotExist());
    }

    /**
     * The guard is {@code postOnBehalf:write}, not {@code properties:write}. A moderator who may
     * approve and flag supply is not automatically the desk accountable for listings the platform
     * created in a stranger's name.
     */
    @Test
    @DisplayName("a buyer cannot move the funnel")
    void buyersCannotAdvanceTheFunnel() throws Exception {
        User owner = user("9852000012", "owner");
        User staff = user("9852000013", "staff");
        User buyer = user("9852000014", "buyer");
        Property p = listing(owner, true, staff.getId().toString());

        move(buyer, p, PipelineStage.DOCS_SUBMITTED, 403);
    }
}
