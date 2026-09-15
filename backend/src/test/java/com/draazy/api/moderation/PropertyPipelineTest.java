package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.PipelineStage;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * {@code POST /properties/{id}/pipeline} — hand-back funnel for staff-posted listings, with an
 * audience gate on {@code adminPipeline} so buyers cannot see which listings the platform manufactured.
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
     * Milestones are derived, not stored — a row saying {@code claimed} with
     * {@code photosUploaded: false} would be unanswerable, and derivation makes it unrepresentable.
     */
    @Test
    @DisplayName("the milestone flags are derived from the milestone, so they cannot contradict it")
    void milestonesFollowTheStage() throws Exception {
        User owner = user("9852000001", "owner");
        User staff = user("9852000002", "staff");
        Property p = listing(owner, true, staff.getId().toString());

        move(staff, p, PipelineStage.PHOTOS_UPLOADED, 200);
        mvc.perform(get("/admin/properties").param("q", "Pipeline flat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].adminPipeline.handbackMilestone")
                        .value(PipelineStage.PHOTOS_UPLOADED))
                // Reaching hand-back pins the acquisition funnel at its last stage: leaving it at
                // {@code listed} would show the board a listing still waiting for its paperwork.
                .andExpect(jsonPath("$.content[0].adminPipeline.pipelineStage")
                        .value(PipelineStage.DOCS_SUBMITTED))
                .andExpect(jsonPath("$.content[0].adminPipeline.photosUploaded").value(true))
                .andExpect(jsonPath("$.content[0].adminPipeline.identityVerified").value(false))
                .andExpect(jsonPath("$.content[0].adminPipeline.claimLinkSent").value(false));

        move(staff, p, PipelineStage.CLAIMED, 200);
        mvc.perform(get("/admin/properties").param("q", "Pipeline flat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.content[0].adminPipeline.photosUploaded").value(true))
                .andExpect(jsonPath("$.content[0].adminPipeline.identityVerified").value(true))
                .andExpect(jsonPath("$.content[0].adminPipeline.claimLinkSent").value(true));
    }

    /**
     * The two axes are independent — a listing still being chased for information has reached no
     * hand-back milestone, so its flags must all read false whatever the acquisition stage says.
     */
    @Test
    @DisplayName("the console's two extra stages are accepted, and reach no hand-back milestone")
    void acquisitionStagesAreSeparateFromHandback() throws Exception {
        User owner = user("9852000011", "owner");
        User staff = user("9852000012", "staff");
        Property p = listing(owner, true, staff.getId().toString());

        // Both were board-only vocabulary and would have been refused at the CHECK constraint.
        move(staff, p, PipelineStage.CONTACTED, 200);
        move(staff, p, PipelineStage.INFO_COLLECTED, 200);

        mvc.perform(get("/admin/properties").param("q", "Pipeline flat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].adminPipeline.pipelineStage")
                        .value(PipelineStage.INFO_COLLECTED))
                .andExpect(jsonPath("$.content[0].adminPipeline.handbackMilestone").doesNotExist())
                .andExpect(jsonPath("$.content[0].adminPipeline.photosUploaded").value(false))
                .andExpect(jsonPath("$.content[0].adminPipeline.identityVerified").value(false))
                .andExpect(jsonPath("$.content[0].adminPipeline.claimLinkSent").value(false));
    }

    /**
     * {@code under_review} and {@code live} are {@code status} in disguise — accepting them here
     * would give a listing two disagreeing opinions about whether it is public.
     */
    @Test
    @DisplayName("the two console stages that are really `status` are refused")
    void statusMasqueradingAsAStageIsRefused() throws Exception {
        User owner = user("9852000013", "owner");
        User staff = user("9852000014", "staff");
        Property p = listing(owner, true, staff.getId().toString());

        move(staff, p, "under_review", 400);
        move(staff, p, "live", 400);
    }

    /**
     * Backwards allowed (evidence withdrawn — wrong-flat document, stale claim number). Stepping
     * back onto acquisition also clears the milestone, or a row contradicts itself on paperwork.
     */
    @Test
    @DisplayName("a stage can be walked back when evidence is withdrawn, and the hand-back unwinds")
    void stagesCanGoBackwards() throws Exception {
        User owner = user("9852000003", "owner");
        User staff = user("9852000004", "staff");
        Property p = listing(owner, true, staff.getId().toString());

        move(staff, p, PipelineStage.CLAIM_SENT, 200);
        move(staff, p, PipelineStage.LISTED, 200);

        properties.flush();
        // Read the columns, not the entity — a cached instance would report the values just set
        // regardless of whether the second call reached the database at all.
        assertThat(jdbc.queryForObject(
                "select pipeline_stage from properties where id = ?", String.class, p.getId()))
                .isEqualTo(PipelineStage.LISTED);
        assertThat(jdbc.queryForObject(
                "select handback_milestone from properties where id = ?", String.class, p.getId()))
                .isNull();
    }

    /** An owner-posted listing has already arrived where the funnel is going, so it can never clear. */
    @Test
    @DisplayName("a listing its owner posted has no hand-back to track")
    void ownerPostedListingsAreRefused() throws Exception {
        User owner = user("9852000005", "owner");
        User staff = user("9852000006", "staff");
        Property p = listing(owner, false, null);

        move(staff, p, PipelineStage.DOCS_SUBMITTED, 409);
    }

    /**
     * Both columns null on an untouched concierge listing — {@code indexOf(null)} on the derivation
     * list threw and the whole queue answered 500. Asserts the row renders, not just the flags.
     */
    @Test
    @DisplayName("a concierge listing nobody has moved yet still renders on the queue")
    void untouchedConciergeListingsRender() throws Exception {
        User owner = user("9852000021", "owner");
        User staff = user("9852000022", "staff");
        listing(owner, true, staff.getId().toString());

        mvc.perform(get("/admin/properties").param("q", "Pipeline flat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].adminPipeline.postedByAdmin").value(true))
                // {@code markPostedOnBehalf} starts the funnel at {@code listed}; the hand-back
                // column stays null until the owner moves, and that null is the case exercised here.
                .andExpect(jsonPath("$.content[0].adminPipeline.pipelineStage")
                        .value(PipelineStage.LISTED))
                .andExpect(jsonPath("$.content[0].adminPipeline.handbackMilestone").doesNotExist())
                .andExpect(jsonPath("$.content[0].adminPipeline.photosUploaded").value(false))
                .andExpect(jsonPath("$.content[0].adminPipeline.identityVerified").value(false))
                .andExpect(jsonPath("$.content[0].adminPipeline.claimLinkSent").value(false));
    }

    /** An unknown stage is a client error, not a seventh stage to be silently accepted. */
    @Test
    @DisplayName("the console's own stage names are refused, not stored")
    void unknownStagesAreRejected() throws Exception {
        User owner = user("9852000007", "owner");
        User staff = user("9852000008", "staff");
        Property p = listing(owner, true, staff.getId().toString());

        // Caught in Java so the caller gets a sentence naming valid stages rather than a 500 from
        // the CHECK constraint.
        move(staff, p, "under_review", 400);
    }

    /**
     * {@code PropertyResponse} is shared between the queue and the public detail page, so the
     * funnel must be omitted from the projection rather than merely ignored by consumers.
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
     * Guard is {@code postOnBehalf:write}, not {@code properties:write}: approving supply is not
     * the same authority as being the desk of record for a listing in a stranger's name.
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
