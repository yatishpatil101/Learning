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
 * <p><strong>Why two vocabularies became two columns (D27).</strong> The admin board shipped
 * {@code contacted, info_collected, listed, docs_submitted, under_review, live}; V3's column said
 * {@code listed, docs_submitted, photos_uploaded, aadhaar_verified, claim_sent, claimed}. They
 * agreed on two, and four of the board's six would have been refused by Postgres on write. That was
 * never a naming argument: the board's early values ask how far the owner got towards there being a
 * listing, the column's late values ask how far the platform got towards giving it back, and a
 * listing sits at a point on both at once. V92 split them — {@code pipeline_stage} keeps the
 * acquisition funnel, {@code handback_milestone} takes the hand-back — and this route accepts a
 * point on either, deciding from the value which column is meant. {@code under_review} and
 * {@code live} survive in neither: they are {@code status} under different names.
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
     * The three contract booleans are derived from the hand-back milestone, so reaching a later one
     * sets every earlier flag without anyone writing them.
     *
     * <p>This is the whole reason they are not stored. A row saying {@code claimed} with
     * {@code photosUploaded: false} would be unanswerable — somebody would have to decide which
     * half to believe — and derivation makes that state unrepresentable.
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
                // Reaching the hand-back pins the acquisition funnel at its last stage: the
                // paperwork must be in before a hand-back can start, and leaving this behind at
                // `listed` would show the board a listing still waiting for documents it has.
                .andExpect(jsonPath("$.content[0].adminPipeline.pipelineStage")
                        .value(PipelineStage.DOCS_SUBMITTED))
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
     * The two axes are independent facts, and the acquisition stage is not one of the hand-back
     * milestones dressed up. A listing still being chased for information has reached no milestone,
     * and its flags must all read false however far along the board it looks.
     */
    @Test
    @DisplayName("the console's two extra stages are accepted, and reach no hand-back milestone")
    void acquisitionStagesAreSeparateFromHandback() throws Exception {
        User owner = user("9852000011", "owner");
        User staff = user("9852000012", "staff");
        Property p = listing(owner, true, staff.getId().toString());

        // Both were board-only vocabulary before D27 and would have been refused on write.
        move(staff, p, PipelineStage.CONTACTED, 200);
        move(staff, p, PipelineStage.INFO_COLLECTED, 200);

        mvc.perform(get("/admin/properties").param("q", "Pipeline flat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].adminPipeline.pipelineStage")
                        .value(PipelineStage.INFO_COLLECTED))
                .andExpect(jsonPath("$.content[0].adminPipeline.handbackMilestone").doesNotExist())
                .andExpect(jsonPath("$.content[0].adminPipeline.photosUploaded").value(false))
                .andExpect(jsonPath("$.content[0].adminPipeline.aadhaarVerified").value(false))
                .andExpect(jsonPath("$.content[0].adminPipeline.claimLinkSent").value(false));
    }

    /**
     * {@code under_review} and {@code live} are the two console stages that did not survive D27.
     * They are {@code status} under different names, and accepting them would give a listing two
     * disagreeing opinions about whether it is public. The board still shows those columns; it
     * reads them off {@code status} rather than storing them here.
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
     * Backwards is allowed, because the stages record what has actually come back from an owner and
     * that can be undone — a document turns out to be the wrong flat, a claim link goes to a stale
     * number. A forward-only funnel leaves the desk no way to say so except to lie.
     *
     * <p>Stepping back onto the acquisition funnel also clears the hand-back milestone. The
     * alternative strands a row claiming its claim link went out while also saying its paperwork is
     * still outstanding, which is the exact contradiction D27 split the column to prevent.
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
        // Read the columns, not the entity: a cached instance would report the values this test
        // just set regardless of whether the second call reached the database at all.
        assertThat(jdbc.queryForObject(
                "select pipeline_stage from properties where id = ?", String.class, p.getId()))
                .isEqualTo(PipelineStage.LISTED);
        assertThat(jdbc.queryForObject(
                "select handback_milestone from properties where id = ?", String.class, p.getId()))
                .isNull();
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

    /**
     * The regression that D27 shipped and the live suite caught: a concierge listing nobody has
     * moved yet.
     *
     * <p>Both columns are null on such a row, and every other test in this file writes at least one
     * of them before reading, so none of them exercised the shape that is by far the most common on
     * a real desk — a listing that has just been created. Deriving the three flags called
     * {@code indexOf(null)} on a {@code List.of} constant, which throws rather than answering -1,
     * so the whole moderation queue answered 500 as soon as one un-moved concierge listing was in
     * the page. This asserts the row renders, not merely that the flags are false.
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
                // `markPostedOnBehalf` starts the acquisition funnel at `listed` — the desk has by
                // definition listed it. The hand-back column stays null until the owner does
                // something, and that null is the case this test exists for.
                .andExpect(jsonPath("$.content[0].adminPipeline.pipelineStage")
                        .value(PipelineStage.LISTED))
                .andExpect(jsonPath("$.content[0].adminPipeline.handbackMilestone").doesNotExist())
                .andExpect(jsonPath("$.content[0].adminPipeline.photosUploaded").value(false))
                .andExpect(jsonPath("$.content[0].adminPipeline.aadhaarVerified").value(false))
                .andExpect(jsonPath("$.content[0].adminPipeline.claimLinkSent").value(false));
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
