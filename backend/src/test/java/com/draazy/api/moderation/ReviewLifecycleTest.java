package com.draazy.api.moderation;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ReviewLifecycleTest extends AbstractApiTest {
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    private final List<String> actors = new ArrayList<>();

    private User user(String mobile, String role) {
        User user = new User(mobile, role);
        user.setMobileVerified(true);
        user = users.saveAndFlush(user);
        actors.add(user.getId().toString());
        return user;
    }

    private Property listing(User owner) {
        return properties.saveAndFlush(new Property(owner, "Lifecycle home", "rent", "Flat",
                25000L, "Baner", "Pune"));
    }

    private void message(Property p, User actor, String json, String step, boolean needsInfo) throws Exception {
        mvc.perform(post("/properties/" + p.getId() + "/verification/messages")
                .header("Authorization", bearer(actor)).contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.progress.step").value(step))
                .andExpect(needsInfo ? jsonPath("$.progress.flags").value(org.hamcrest.Matchers.hasItem("needs_info"))
                        : jsonPath("$.progress.flags").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.hasItem("needs_info"))));
    }

    @AfterEach void cleanupAudit() {
        actors.forEach(id -> jdbc.update("delete from audit_log where actor = ?", id));
    }

    @Test void onlyExplicitStaffClarificationRaisesNeedsInfoAndTheOwnerReplyClearsIt() throws Exception {
        User owner = user("9800011901", "owner");
        User staff = user("9800011902", "staff");
        Property p = listing(owner);
        message(p, staff, "{\"body\":\"Hello\"}", "submitted", false);
        mvc.perform(post("/properties/" + p.getId() + "/verification/start")
                .header("Authorization", bearer(staff)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.progress.step").value("in_review"));
        message(p, staff, "{\"body\":\"Need proof\",\"clarificationRequested\":true}", "in_review", true);
        message(p, staff, "{\"body\":\"Thank you\"}", "in_review", true);
        message(p, owner, "{\"body\":\"Here is the answer\"}", "in_review", false);
        properties.flush();
        assertThat(jdbc.queryForObject("select count(*) from review_messages m join property_reviews r "
                + "on r.id=m.review_id where r.property_id=? and m.clarification_requested", Long.class,
                p.getId())).isEqualTo(1);
    }

    @Test void ownerCannotRequestClarification() throws Exception {
        User owner = user("9800011903", "owner");
        Property p = listing(owner);
        mvc.perform(post("/properties/" + p.getId() + "/verification/messages")
                .header("Authorization", bearer(owner)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Escalate\",\"clarificationRequested\":true}"))
                .andExpect(status().isForbidden());
    }

    private void tickChecklist(Property p, User staff) throws Exception {
        String caseFile = mvc.perform(get("/properties/" + p.getId() + "/verification")
                .header("Authorization", bearer(staff))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> items = com.jayway.jsonpath.JsonPath.read(caseFile, "$.checklist[*].item");
        for (String item : items) {
            mvc.perform(patch("/properties/" + p.getId() + "/verification/checklist")
                    .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"item\":\"" + item + "\",\"pass\":true}"))
                    .andExpect(status().isOk());
        }
    }

    @Test void approvingAnUnfiledListingIsRefusedUntilItsLocalityExists() throws Exception {
        User owner = user("9800011904", "owner");
        User staff = user("9800011905", "staff");
        Property p = listing(owner);
        mvc.perform(post("/properties/" + p.getId() + "/verification")
                .header("Authorization", bearer(owner))).andExpect(status().isCreated());
        tickChecklist(p, staff);
        mvc.perform(post("/properties/" + p.getId() + "/verification/decision")
                .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\"}"))
                .andExpect(status().isConflict());
        properties.flush();
        assertThat(jdbc.queryForObject("select status from properties where id=?", String.class,
                p.getId())).isEqualTo("pending");
        mvc.perform(get("/properties/" + p.getId())).andExpect(status().isNotFound());
    }

    private void fileLocality(Property property) {
        property.setLocalitySlug(jdbc.queryForObject("select slug from localities limit 1", String.class));
        properties.saveAndFlush(property);
    }

    // Verification approval also publishes; the old two-step path left
    // verified listings invisible with no owner.
    private void hardBrokerSignal(Property property, User reporter) {
        jdbc.update("""
                insert into reports (target_type, target_id, reporter_id, reason, details, status)
                values ('user', ?, ?, 'brokerage', 'broker', 'open'),
                       ('user', ?, ?, 'brokerage', 'broker', 'actioned')
                """, property.getOwner().getId().toString(), reporter.getId(),
                property.getOwner().getId().toString(), reporter.getId());
    }

    @Test void approvingAtTheDeskVerifiesAndPublishesInOneStep() throws Exception {
        User owner = user("9800011906", "owner");
        User staff = user("9800011907", "staff");
        Property p = listing(owner);
        fileLocality(p);
        mvc.perform(post("/properties/" + p.getId() + "/verification")
                .header("Authorization", bearer(owner))).andExpect(status().isCreated());
        tickChecklist(p, staff);
        mvc.perform(post("/properties/" + p.getId() + "/verification/decision")
                .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.progress.track").value("owner"))
                .andExpect(jsonPath("$.progress.step").value("live"));
        mvc.perform(get("/properties/" + p.getId())).andExpect(status().isOk());
        properties.flush();
        assertThat(jdbc.queryForObject("select status from properties where id=?", String.class,
                p.getId())).isEqualTo("approved");
    }

    @Test void deskApprovalStillNeedsTheSecondApproverOnAHardSignal() throws Exception {
        User staff = user("9800011920", "staff");
        User reporter = user("9800011921", "buyer");
        Property p = listing(user("9800011922", "owner"));
        fileLocality(p);
        mvc.perform(post("/properties/" + p.getId() + "/verification")
                .header("Authorization", bearer(staff))).andExpect(status().isCreated());
        tickChecklist(p, staff);
        hardBrokerSignal(p, reporter);

        mvc.perform(post("/properties/" + p.getId() + "/verification/decision")
                .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("second_approver_required"));

        properties.flush();
        assertThat(jdbc.queryForObject("select status from properties where id= ?", String.class,
                p.getId())).isEqualTo("pending");
    }

    @Test void staffOwnerCannotVerifyOrPublishTheirOwnListing() throws Exception {
        User staffOwner = user("9800011912", "staff");
        Property p = listing(staffOwner);
        mvc.perform(post("/properties/" + p.getId() + "/verification/decision")
                .header("Authorization", bearer(staffOwner)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\"}"))
                .andExpect(status().isForbidden());
    }

    @Test void staffMakerCannotVerifyTheirOnBehalfListing() throws Exception {
        User staff = user("9800011913", "staff");
        Property p = listing(user("9800011914", "owner"));
        p.markPostedOnBehalf(staff.getId().toString());
        properties.saveAndFlush(p);
        mvc.perform(post("/properties/" + p.getId() + "/verification/start")
                .header("Authorization", bearer(staff))).andExpect(status().isForbidden());
    }

    @Test void staffTrackRecordsAnAuthenticatedOpenWithoutConfirmingOrPublishing() throws Exception {
        User owner = user("9800011915", "owner");
        Property p = listing(owner);
        p.markPostedOnBehalf("some-other-staff");
        properties.saveAndFlush(p);
        mvc.perform(post("/me/listings/" + p.getId() + "/opened")
                .header("Authorization", bearer(owner))).andExpect(status().isNoContent());
        properties.flush();
        java.sql.Timestamp firstOpen = jdbc.queryForObject(
                "select claim_link_opened_at from properties where id= ?", java.sql.Timestamp.class, p.getId());
        assertThat(firstOpen).isNotNull();
        mvc.perform(post("/me/listings/" + p.getId() + "/opened")
                .header("Authorization", bearer(owner))).andExpect(status().isNoContent());
        properties.flush();
        assertThat(p.getStatus()).isEqualTo("pending");
        assertThat(p.getOwnerConfirmedAt()).isNull();
        assertThat(jdbc.queryForObject("select claim_link_opened_at from properties where id= ?",
                java.sql.Timestamp.class, p.getId())).isEqualTo(firstOpen);
    }

    @Test void staffPostedListingPublishesOnlyAfterTheOwnerConfirms() throws Exception {
        User maker = user("9800011930", "staff");
        User checker = user("9800011931", "staff");
        User owner = user("9800011932", "owner");
        Property p = listing(owner);
        p.markPostedOnBehalf(maker.getId().toString());
        fileLocality(p);
        mvc.perform(post("/properties/" + p.getId() + "/verification")
                .header("Authorization", bearer(owner))).andExpect(status().isCreated());
        tickChecklist(p, checker);
        mvc.perform(post("/properties/" + p.getId() + "/verification/decision")
                .header("Authorization", bearer(checker)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("owner_not_confirmed"));

        mvc.perform(post("/me/listings/" + p.getId() + "/confirm")
                .header("Authorization", bearer(owner))).andExpect(status().isNoContent());
        properties.flush();
        java.sql.Timestamp confirmed = jdbc.queryForObject(
                "select owner_confirmed_at from properties where id= ?", java.sql.Timestamp.class, p.getId());
        assertThat(confirmed).isNotNull();
        mvc.perform(post("/me/listings/" + p.getId() + "/confirm")
                .header("Authorization", bearer(owner))).andExpect(status().isNoContent());
        properties.flush();
        assertThat(jdbc.queryForObject("select owner_confirmed_at from properties where id= ?",
                java.sql.Timestamp.class, p.getId())).isEqualTo(confirmed);
        assertThat(jdbc.queryForObject("select count(*) from notifications where user_id= ? and type= ?",
                Long.class, maker.getId(), "listing.owner_confirmed")).isEqualTo(1);

        mvc.perform(post("/properties/" + p.getId() + "/verification/decision")
                .header("Authorization", bearer(checker)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.progress.track").value("staff"))
                .andExpect(jsonPath("$.progress.step").value("live"));
    }

    @Test void onlyTheOwnerOfAStaffPostedListingCanConfirmIt() throws Exception {
        User owner = user("9800011933", "owner");
        Property ownPosted = listing(owner);
        mvc.perform(post("/me/listings/" + ownPosted.getId() + "/confirm")
                .header("Authorization", bearer(owner))).andExpect(status().isConflict());
        Property staffPosted = listing(owner);
        staffPosted.markPostedOnBehalf("some-other-staff");
        properties.saveAndFlush(staffPosted);
        mvc.perform(post("/me/listings/" + staffPosted.getId() + "/confirm")
                .header("Authorization", bearer(user("9800011934", "owner")))).andExpect(status().isNotFound());
        assertThat(jdbc.queryForObject("select owner_confirmed_at from properties where id= ?",
                java.sql.Timestamp.class, staffPosted.getId())).isNull();
    }

    @Test void ownerTrackOpenRecordsNothing() throws Exception {
        User owner = user("9800011990", "owner");
        Property p = listing(owner);
        mvc.perform(post("/me/listings/" + p.getId() + "/opened")
                .header("Authorization", bearer(owner))).andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("select claim_link_opened_at from properties where id= ?",
                java.sql.Timestamp.class, p.getId())).isNull();
    }

    @Test void anotherUsersOpenIsNotFound() throws Exception {
        Property p = listing(user("9800011991", "owner"));
        p.markPostedOnBehalf("some-other-staff");
        properties.saveAndFlush(p);
        mvc.perform(post("/me/listings/" + p.getId() + "/opened")
                .header("Authorization", bearer(user("9800011992", "owner")))).andExpect(status().isNotFound());
        assertThat(jdbc.queryForObject("select claim_link_opened_at from properties where id= ?",
                java.sql.Timestamp.class, p.getId())).isNull();
    }

    @Test void liveRecheckStaysLiveAfterVerification() throws Exception {
        User staff = user("9800011916", "staff");
        Property p = listing(user("9800011917", "owner"));
        p.setStatus("approved");
        p.requestRecheck(List.of("price"));
        properties.saveAndFlush(p);
        fileLocality(p);
        mvc.perform(post("/properties/" + p.getId() + "/verification")
                .header("Authorization", bearer(staff))).andExpect(status().isCreated());
        tickChecklist(p, staff);
        mvc.perform(post("/properties/" + p.getId() + "/verification/decision")
                .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.progress.step").value("live"));
        assertThat(p.getStatus()).isEqualTo("approved");
        assertThat(p.isRecheckPending()).isFalse();
    }

        @Test void preparingAClaimLinkDoesNotCountAsSendingIt() throws Exception {
                User staff = user("9800011918", "staff");
                Property p = listing(user("9800011919", "owner"));
                p.markPostedOnBehalf(staff.getId().toString());
                properties.saveAndFlush(p);
                String result = mvc.perform(post("/properties/" + p.getId() + "/outreach")
                                .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                                .content("{\"templateId\":\"wa-photos\"}"))
                                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("prepared"))
                                .andReturn().getResponse().getContentAsString();
                String messageId = com.jayway.jsonpath.JsonPath.read(result, "$.id");
                assertThat(p.getClaimLinkSentAt()).isNull();
                mvc.perform(get("/properties/" + p.getId() + "/outreach").header("Authorization", bearer(staff)))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$[?(@.id == '" + messageId + "')].status").value("prepared"));
        }
}
