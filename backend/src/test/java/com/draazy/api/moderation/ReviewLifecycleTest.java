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

    private void message(Property p, User actor, String json, String stage) throws Exception {
        mvc.perform(post("/properties/" + p.getId() + "/verification/messages")
                .header("Authorization", bearer(actor)).contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.lifecycleStage").value(stage));
    }

    @AfterEach void cleanupAudit() {
        actors.forEach(id -> jdbc.update("delete from audit_log where actor = ?", id));
    }

    @Test void onlyExplicitStaffClarificationChangesTheStage() throws Exception {
        User owner = user("9800011901", "owner");
        User staff = user("9800011902", "staff");
        Property p = listing(owner);
        message(p, staff, "{\"body\":\"Hello\"}", "submitted");
        mvc.perform(post("/properties/" + p.getId() + "/verification/start")
                .header("Authorization", bearer(staff)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.lifecycleStage").value("in_review"));
        message(p, staff, "{\"body\":\"Need proof\",\"clarificationRequested\":true}", "clarification");
        message(p, staff, "{\"body\":\"Thank you\"}", "clarification");
        message(p, owner, "{\"body\":\"Here is the answer\"}", "in_review");
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

    @Test void verifyDoesNotPublishAndPublicationRequiresLocality() throws Exception {
        User owner = user("9800011904", "owner");
        User staff = user("9800011905", "staff");
        Property p = listing(owner);
        mvc.perform(post("/properties/" + p.getId() + "/verification")
                .header("Authorization", bearer(owner))).andExpect(status().isCreated());
        mvc.perform(post("/properties/" + p.getId() + "/verification/decision")
                .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.lifecycleStage").value("verified"));
        properties.flush();
        assertThat(jdbc.queryForObject("select status from properties where id=?", String.class,
                p.getId())).isEqualTo("pending");
        mvc.perform(get("/properties/" + p.getId())).andExpect(status().isNotFound());
        mvc.perform(post("/properties/" + p.getId() + "/publish")
                .header("Authorization", bearer(staff))).andExpect(status().isConflict());
    }

    private void fileLocality(Property property) {
        property.setLocalitySlug(jdbc.queryForObject("select slug from localities limit 1", String.class));
        properties.saveAndFlush(property);
    }

    @Test void explicitVerifyThenPublishMakesTheListingReachable() throws Exception {
        User owner = user("9800011906", "owner");
        User staff = user("9800011907", "staff");
        Property p = listing(owner);
        fileLocality(p);
        mvc.perform(patch("/properties/" + p.getId() + "/lifecycle")
                .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"lifecycleStage\":\"verified\",\"reason\":\"Documents checked\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.lifecycleStage").value("verified"));
        mvc.perform(post("/properties/" + p.getId() + "/verification/start")
                .header("Authorization", bearer(staff)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.lifecycleStage").value("verified"));
        mvc.perform(post("/properties/" + p.getId() + "/publish")
                .header("Authorization", bearer(staff))).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.lifecycleStage").value("live"));
        mvc.perform(get("/properties/" + p.getId())).andExpect(status().isOk())
                .andExpect(jsonPath("$.lifecycleTrack").value("owner"));
        properties.flush();
        assertThat(jdbc.queryForObject("select lifecycle_stage from properties where id=?", String.class,
                p.getId())).isEqualTo("live");
    }

    @Test void manualLiveCannotSkipVerification() throws Exception {
        User staff = user("9800011908", "staff");
        Property p = listing(user("9800011909", "owner"));
        fileLocality(p);
        mvc.perform(patch("/properties/" + p.getId() + "/lifecycle")
                .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"lifecycleStage\":\"live\",\"reason\":\"Try to bypass\"}"))
                .andExpect(status().isConflict());
    }

    @Test void correctionPersistsAndCannotCrossTracks() throws Exception {
        User staff = user("9800011910", "staff");
        Property p = listing(user("9800011911", "owner"));
        mvc.perform(patch("/properties/" + p.getId() + "/lifecycle")
                .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"lifecycleStage\":\"in_review\",\"reason\":\"Resumed review\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.lifecycleStage").value("in_review"));
        properties.flush();
        assertThat(jdbc.queryForObject("select lifecycle_stage from properties where id=?", String.class,
                p.getId())).isEqualTo("in_review");
        mvc.perform(patch("/properties/" + p.getId() + "/lifecycle")
                .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"lifecycleStage\":\"photos_docs\",\"reason\":\"Wrong track\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test void staffOwnerCannotVerifyOrPublishTheirOwnListing() throws Exception {
        User staffOwner = user("9800011912", "staff");
        Property p = listing(staffOwner);
        mvc.perform(post("/properties/" + p.getId() + "/publish")
                .header("Authorization", bearer(staffOwner))).andExpect(status().isForbidden());
        mvc.perform(patch("/properties/" + p.getId() + "/lifecycle")
                .header("Authorization", bearer(staffOwner)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"lifecycleStage\":\"verified\",\"reason\":\"Self-check\"}"))
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

    @Test void staffTrackRecordsAnAuthenticatedOpenButDoesNotPublish() throws Exception {
        User owner = user("9800011915", "owner");
        Property p = listing(owner);
        p.markPostedOnBehalf("some-other-staff");
        properties.saveAndFlush(p);
        assertThat(p.getLifecycleStage()).isNull();
        mvc.perform(post("/me/listings/" + p.getId() + "/opened")
                .header("Authorization", bearer(owner))).andExpect(status().isNoContent());
        properties.flush();
        assertThat(jdbc.queryForObject("select lifecycle_stage from properties where id=?", String.class,
                p.getId())).isEqualTo("opened");
        p.recordLifecycleMedia();
        properties.saveAndFlush(p);
        mvc.perform(post("/me/listings/" + p.getId() + "/opened")
                .header("Authorization", bearer(owner))).andExpect(status().isNoContent());
        assertThat(p.getLifecycleStage()).isEqualTo("photos_docs");
        assertThat(p.getStatus()).isEqualTo("pending");
    }

    @Test void liveRecheckStaysLiveAfterVerification() throws Exception {
        User staff = user("9800011916", "staff");
        Property p = listing(user("9800011917", "owner"));
        p.setStatus("approved");
        p.requestRecheck(List.of("price"));
        properties.saveAndFlush(p);
        mvc.perform(post("/properties/" + p.getId() + "/verification")
                .header("Authorization", bearer(staff))).andExpect(status().isCreated());
        mvc.perform(post("/properties/" + p.getId() + "/verification/decision")
                .header("Authorization", bearer(staff)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.lifecycleStage").value("live"));
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
                assertThat(p.getLifecycleStage()).isNull();
                mvc.perform(post("/properties/" + p.getId() + "/outreach/" + messageId + "/sent")
                                .header("Authorization", bearer(staff))).andExpect(status().isNoContent());
                properties.flush();
                assertThat(p.getLifecycleStage()).isEqualTo("link_sent");
                assertThat(jdbc.queryForObject("select status from outbound_message where id=?::uuid",
                                String.class, messageId)).isEqualTo("sent");
        }
}