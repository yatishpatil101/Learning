package com.draazy.api.moderation;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Moderation — accountability, self-dealing and blast radius")
class ModerationBehaviourTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    // Audit writes use `REQUIRES_NEW`, so they escape this test's rollback too.
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        if ("staff".equals(role)) {
            jdbc.update("""
                    INSERT INTO back_office_permissions (user_id, permissions)
                    VALUES (?::uuid, ?::jsonb)
                    ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                    """, saved.getId().toString(),
                    "[\"kyc\",\"propertyVerification\",\"listingModeration\",\"support\",\"content\",\"reports\",\"desk:rental\"]");
        }
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Baner", "rent", "apartment", 28000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        p.setStatus(PropertyStatus.PENDING);

        // Filed, because approval refuses an unfiled listing — a fixture tripping a guard it never mentions
        // gets "fixed" by weakening it.
        p.setLocalitySlug("baner");
        return properties.saveAndFlush(p);
    }

    /** Audit rows for one action <em>on one specific entity</em> — never the whole action. */
    private List<Map<String, Object>> auditRows(String action, Object entityId) {
        return jdbc.queryForList(
                "select * from audit_log where action = ? and entity_id = ? order by at desc",
                action, String.valueOf(entityId));
    }

    private void tickChecklist(Property listing, User staff) throws Exception {
        String opened = mvc.perform(post("/properties/{id}/verification/start", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> items = com.jayway.jsonpath.JsonPath.read(opened, "$.checklist[*].item");
        for (String item : items) {
            mvc.perform(patch("/properties/{id}/verification/checklist", listing.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"item\":\"" + item + "\",\"pass\":true}"))
                    .andExpect(status().isOk());
        }
    }

    private void hardBrokerSignal(Property listing, User reporter) {
        jdbc.update("""
                insert into reports (target_type, target_id, reporter_id, reason, details, status)
                values ('user', ?, ?, 'brokerage', 'broker', 'open'),
                       ('user', ?, ?, 'brokerage', 'broker', 'actioned')
                """, listing.getOwner().getId().toString(), reporter.getId(),
                listing.getOwner().getId().toString(), reporter.getId());
    }

    @Test
    @DisplayName("approving a listing writes an audit row naming the server-resolved actor")
    void moderationIsAudited() throws Exception {
        User owner = user("9800000101", "owner", "Owner");
        User staff = user("9800000102", "staff", "Ops");
        Property listing = listing(owner);
        tickChecklist(listing, staff);

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"docs verified\"}"))
                .andExpect(status().isOk());

        List<Map<String, Object>> rows = auditRows("property.status", listing.getId());
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("actor")).isEqualTo(staff.getId().toString());
        assertThat(rows.get(0).get("actor_role")).isEqualTo("staff");
        assertThat(rows.get(0).get("entity_id")).isEqualTo(listing.getId().toString());

        assertThat(metadataField(rows.get(0), "from")).isEqualTo("pending");
        assertThat(metadataField(rows.get(0), "to")).isEqualTo("approved");
        assertThat(metadataField(rows.get(0), "reason")).isEqualTo("docs verified");
    }

    private String metadataField(Map<String, Object> auditRow, String key) {
        return jdbc.queryForObject("select metadata->>? from audit_log where id = ?",
                String.class, key, auditRow.get("id"));
    }

    // The checklist stays unticked on purpose — that is the whole difference between the two.
    @Test
    @DisplayName("a queue approval is refused until the checklist is complete")
    void queueApprovalRequiresChecklist() throws Exception {
        User owner = user("9800000141", "owner", "Owner");
        User staff = user("9800000142", "staff", "Ops");
        Property listing = listing(owner);

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"looks fine as submitted\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("checklist_incomplete"));
    }

    @Test
    @DisplayName("queue approval with a hard broker signal requires a second approver")
    void queueApprovalWithHardSignalRequiresOverride() throws Exception {
        User owner = user("9800000167", "owner", "Owner");
        User staff = user("9800000168", "staff", "Ops");
        User reporter = user("9800000169", "buyer", "Reporter");
        Property listing = listing(owner);
        tickChecklist(listing, staff);
        hardBrokerSignal(listing, reporter);

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"docs verified\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("second_approver_required"));
    }

    @Test
    @DisplayName("queue approval cannot reverse a final rejection")
    void queueApprovalCannotReverseFinalReject() throws Exception {
        User owner = user("9800000170", "owner", "Owner");
        User staff = user("9800000171", "staff", "Ops");
        Property listing = listing(owner);
        listing.setStatus(PropertyStatus.REJECTED);
        properties.saveAndFlush(listing);

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"appeal accepted\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("second_approver_required"));
    }

    @Test
    @DisplayName("a rejected listing cannot be flagged or clear-flag reopened")
    void rejectedListingCannotBeFlagReopened() throws Exception {
        User owner = user("9800000172", "owner", "Owner");
        User staff = user("9800000173", "staff", "Ops");
        Property listing = listing(owner);
        listing.setStatus(PropertyStatus.REJECTED);
        properties.saveAndFlush(listing);

        mvc.perform(post("/properties/{id}/flag", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"complaint\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("second_approver_required"));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/properties/{id}/flag", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isConflict());

        assertThat(properties.findById(listing.getId()).orElseThrow().getStatus())
                .isEqualTo(PropertyStatus.REJECTED);
    }

    @Test
    @DisplayName("queue rejection requires a reason code")
    void queueRejectionRequiresReasonCode() throws Exception {
        User owner = user("9800000153", "owner", "Owner");
        User staff = user("9800000154", "staff", "Ops");
        Property listing = listing(owner);

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"rejected\",\"reason\":\"bad\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("reason_code_required"));
    }

    @Test
    @DisplayName("status patch rejects needs-info and flagged as explicit workflows")
    void statusPatchRejectsWorkflowOnlyStatuses() throws Exception {
        User owner = user("9800000180", "owner", "Owner");
        User staff = user("9800000181", "staff", "Ops");
        Property listing = listing(owner);

        for (String statusValue : List.of("needs_info", "flagged")) {
            mvc.perform(patch("/properties/{id}/status", listing.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"" + statusValue + "\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value("invalid_status"));
        }
    }

    // Bulk approve must not create an all-false checklist for every row.
    @Test
    @DisplayName("bulk-style approvals gate each row independently")
    void bulkStyleApprovalGatesEachRow() throws Exception {
        User owner = user("9800000143", "owner", "Owner");
        User staff = user("9800000144", "staff", "Ops");
        Property ready = listing(owner);
        Property blocked = listing(owner);
        tickChecklist(ready, staff);

        mvc.perform(patch("/properties/{id}/status", ready.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());
        mvc.perform(patch("/properties/{id}/status", blocked.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("checklist_incomplete"));

        assertThat(jdbc.queryForObject("select status from properties where id = ?",
                String.class, ready.getId())).isEqualTo(PropertyStatus.APPROVED);
        assertThat(jdbc.queryForObject("select status from properties where id = ?",
                String.class, blocked.getId())).isEqualTo(PropertyStatus.PENDING);
    }

    @Test
    @DisplayName("relisting a rented home needs a fresh checklist")
    void relistNeedsFreshChecklist() throws Exception {
        User owner = user("9800000155", "owner", "Owner");
        User staff = user("9800000156", "staff", "Ops");
        Property listing = listing(owner);
        tickChecklist(listing, staff);
        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());
        properties.findById(listing.getId()).orElseThrow().setStatus(PropertyStatus.RENTED);
        properties.flush();

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("checklist_incomplete"));
    }

    @Test
    @DisplayName("re-approving an edited listing does not overwrite the reviewer who did the work")
    void reApprovalLeavesARealVerdictAlone() throws Exception {
        User owner = user("9800000145", "owner", "Owner");
        User desk = user("9800000146", "staff", "Desk");
        User other = user("9800000147", "staff", "Other");
        Property listing = listing(owner);

        mvc.perform(post("/properties/{id}/verification/start", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                .andExpect(status().isOk());

        tickChecklist(listing, desk);
        mvc.perform(post("/properties/{id}/verification/decision", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"approve\",\"note\":\"deed and tax receipt seen\"}"))
                .andExpect(status().isOk());

        Property approved = properties.findById(listing.getId()).orElseThrow();
        approved.requestRecheck(List.of("price"));
        properties.saveAndFlush(approved);

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(other))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"Owner edits reviewed\"}"))
                .andExpect(status().isOk());

        Map<String, Object> review = jdbc.queryForMap(
                "select * from property_reviews where property_id = ?", listing.getId());
        assertThat(review.get("reviewer")).isEqualTo(desk.getId().toString());
        assertThat(review.get("notes")).isEqualTo("deed and tax receipt seen");
        assertThat(properties.findById(listing.getId()).orElseThrow().isRecheckPending()).isFalse();
    }

    @Test
    @DisplayName("a hard signal first raised after approval escalates the stays-live re-check")
    void recheckPassEscalatesASignalRaisedAfterApproval() throws Exception {
        User owner = user("9800000181", "owner", "Owner");
        User desk = user("9800000182", "staff", "Desk");
        User other = user("9800000183", "staff", "Other");
        User reporter = user("9800000184", "buyer", "Reporter");
        Property listing = approvedWithPendingRecheck(owner, desk);
        hardBrokerSignal(listing, reporter);

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(other))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"Owner edits reviewed\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("second_approver_required"));

        assertThat(properties.findById(listing.getId()).orElseThrow().isRecheckPending()).isTrue();
    }

    @Test
    @DisplayName("a re-check passes over a signal a second approver already cleared at approval")
    void recheckPassKeepsAnOverriddenApproval() throws Exception {
        User owner = user("9800000185", "owner", "Owner");
        User desk = user("9800000186", "staff", "Desk");
        User peer = user("9800000187", "staff", "Peer");
        User reporter = user("9800000188", "buyer", "Reporter");
        Property listing = listing(owner);
        mvc.perform(post("/properties/{id}/verification/start", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                .andExpect(status().isOk());
        tickChecklist(listing, desk);
        hardBrokerSignal(listing, reporter);
        String requested = mvc.perform(post("/properties/{id}/verification/override-requests", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Hard broker signal reviewed\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String requestId = com.jayway.jsonpath.JsonPath.read(requested, "$.overrideRequest.id");
        mvc.perform(post("/properties/{id}/verification/override-requests/{rid}/approve", listing.getId(), requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(peer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"second approval\"}"))
                .andExpect(status().isOk());
        Property approved = properties.findById(listing.getId()).orElseThrow();
        approved.requestRecheck(List.of("price"));
        properties.saveAndFlush(approved);

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"Owner edits reviewed\"}"))
                .andExpect(status().isOk());

        assertThat(properties.findById(listing.getId()).orElseThrow().isRecheckPending()).isFalse();
    }

    private Property approvedWithPendingRecheck(User owner, User desk) throws Exception {
        Property listing = listing(owner);
        mvc.perform(post("/properties/{id}/verification/start", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                .andExpect(status().isOk());
        tickChecklist(listing, desk);
        mvc.perform(post("/properties/{id}/verification/decision", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"approve\",\"note\":\"deed and tax receipt seen\"}"))
                .andExpect(status().isOk());
        Property approved = properties.findById(listing.getId()).orElseThrow();
        approved.requestRecheck(List.of("price"));
        return properties.saveAndFlush(approved);
    }

    @Test
    @DisplayName("a moderation verdict notifies the listing's owner, approve and reject")
    void moderationNotifiesTheOwner() throws Exception {
        User owner = user("9800000131", "owner", "Owner");
        User staff = user("9800000132", "staff", "Ops");
        Property approved = listing(owner);
        Property rejected = listing(owner);
        tickChecklist(approved, staff);

        mvc.perform(patch("/properties/{id}/status", approved.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());
        mvc.perform(patch("/properties/{id}/status", rejected.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"rejected\",\"reasonCode\":\"photos_not_real\","
                                + "\"reason\":\"blurry photos\"}"))
                .andExpect(status().isOk());

        List<Map<String, Object>> notes = notificationsFor(owner);
        assertThat(notes).extracting(n -> n.get("type"))
                .containsExactlyInAnyOrder("listing.approved", "listing.rejected");
        assertThat(notes).anySatisfy(n ->
                assertThat((String) n.get("body")).contains("blurry photos"));
        assertThat(notificationsFor(staff)).isEmpty();
    }

    private List<Map<String, Object>> notificationsFor(User user) {
        return jdbc.queryForList(
                "select type, title, body from notifications where user_id = ?", user.getId());
    }

    @Test
    @DisplayName("a quote in a moderator's note cannot corrupt or forge the audit metadata")
    void auditMetadataIsInjectionProof() throws Exception {
        User owner = user("9800000103", "owner", "Owner");
        User staff = user("9800000104", "staff", "Ops");
        Property listing = listing(owner);

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"rejected\",\"reasonCode\":\"other\","
                                + "\"reason\":\"said \\\"fake\\\", to\\\":\\\"approved\"}"))
                .andExpect(status().isOk());

        Map<String, Object> row = auditRows("property.status", listing.getId()).get(0);

        String to = jdbc.queryForObject("select metadata->>'to' from audit_log where id = ?",
                String.class, row.get("id"));
        assertThat(to).isEqualTo("rejected");
        String reason = jdbc.queryForObject("select metadata->>'reason' from audit_log where id = ?",
                String.class, row.get("id"));
        assertThat(reason).contains("said \"fake\"");
    }

    @Test
    @DisplayName("staff cannot moderate their own listing")
    void staffCannotModerateOwnListing() throws Exception {
        User staff = user("9800000105", "staff", "Ops who lists");
        Property own = listing(staff);

        mvc.perform(patch("/properties/{id}/status", own.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isForbidden());

        assertThat(auditRows("property.status", own.getId())).isEmpty();
    }

    // A self-archiving sole admin would lock the back office permanently.
    @Test
    @DisplayName("staff cannot flag a listing they posted for the owner")
    void staffCannotFlagListingTheyPostedOnBehalf() throws Exception {
        User owner = user("9800000151", "owner", "Owner");
        User staff = user("9800000152", "staff", "Ops");
        Property listing = listing(owner);
        listing.markPostedOnBehalf(staff.getId().toString());
        properties.saveAndFlush(listing);

        mvc.perform(post("/properties/{id}/flag", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"broker\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("an admin cannot archive their own account")
    void adminCannotArchiveSelf() throws Exception {
        User admin = user("9800000106", "admin", "Admin");

        mvc.perform(patch("/users/{id}/archive", admin.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"oops\"}"))
                .andExpect(status().isForbidden());

        assertThat(users.findById(admin.getId()).orElseThrow().isArchived()).isFalse();
    }

    @Test
    @DisplayName("the user list shows masked mobiles and no contact or privacy fields")
    void userListMasksMobileAndDropsPrivateFields() throws Exception {
        User staff = user("9800000107", "staff", "Ops");
        user("9800000108", "buyer", "Subject");

        mvc.perform(get("/users").param("q", "Subject")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].mobile").value("98XXXXX108"))
                .andExpect(jsonPath("$.content[0].email").doesNotExist())
                .andExpect(jsonPath("$.content[0].hideNumber").doesNotExist())
                .andExpect(jsonPath("$.content[0].permissions").doesNotExist())
                .andExpect(jsonPath("$.content[0].mobileVerified").doesNotExist())
                .andExpect(jsonPath("$.content[0].badgePending").value(false));
    }

    @Test
    @DisplayName("customers=true lists owners and buyers only")
    void customersFilterExcludesBackOffice() throws Exception {
        User staff = user("9800000193", "staff", "Custfilter Staff");
        user("9800000194", "owner", "Custfilter Owner");
        user("9800000195", "buyer", "Custfilter Buyer");

        mvc.perform(get("/users").param("q", "Custfilter").param("customers", "true")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[*].role", org.hamcrest.Matchers.everyItem(
                        org.hamcrest.Matchers.oneOf("owner", "buyer"))));

        mvc.perform(get("/users").param("q", "Custfilter")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3));
    }

    // Every signed-in user can add to the report queue and only ops can take anything out.
    @Test
    @DisplayName("back-office lists cap page size and ignore a client sort")
    void listsAreBounded() throws Exception {
        User staff = user("9800000109", "staff", "Ops");

        mvc.perform(get("/reports").param("size", "5000").param("sort", "nonexistentColumn,desc")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(org.hamcrest.Matchers.lessThanOrEqualTo(100)));

        mvc.perform(get("/users").param("size", "5000").param("sort", "nonexistentColumn,desc")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(org.hamcrest.Matchers.lessThanOrEqualTo(100)));
    }

    // Prefix indexes need an anchored, escaped term; `%` must not smuggle in
    // a full-table wildcard scan.
    @Test
    @DisplayName("a wildcard in the search term is matched literally, not interpreted")
    void searchWildcardsAreNeutralised() throws Exception {
        User staff = user("9800000111", "staff", "Ops");
        user("9800000112", "buyer", "Wildcard Target");

        mvc.perform(get("/users").param("q", "%")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));

        // '_' is a single-character wildcard; "W_ldcard" must not match "Wildcard Target".
        mvc.perform(get("/users").param("q", "W_ldcard")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));

        // The honest prefix still works — the escaping must not break the feature it protects.
        mvc.perform(get("/users").param("q", "Wildcard")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    // Anyone signed in may file; duplicate complaints must not masquerade as consensus.
    @Test
    @DisplayName("a second live report on the same target by the same reporter is refused")
    void duplicateLiveReportIsRefused() throws Exception {
        User reporter = user("9800000110", "buyer", "Reporter");
        String body = "{\"targetType\":\"property\",\"targetId\":\"listing-1\",\"reason\":\"fake\"}";

        mvc.perform(post("/reports").header(HttpHeaders.AUTHORIZATION, bearer(reporter))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated());

        mvc.perform(post("/reports").header(HttpHeaders.AUTHORIZATION, bearer(reporter))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("a reason valid for one target type is refused for another")
    void reasonVocabularyIsPerTargetType() throws Exception {
        User reporter = user("9800000111", "buyer", "Reporter");

        mvc.perform(post("/reports").header(HttpHeaders.AUTHORIZATION, bearer(reporter))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetType\":\"user\",\"targetId\":\"u-1\",\"reason\":\"brokerage\"}"))
                .andExpect(status().isCreated());

        mvc.perform(post("/reports").header(HttpHeaders.AUTHORIZATION, bearer(reporter))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetType\":\"property\",\"targetId\":\"p-1\",\"reason\":\"brokerage\"}"))
                .andExpect(status().isBadRequest());
    }

    // Triage is the only verb that moves a report out of `open`.
    @Test
    @DisplayName("a decided report cannot be reopened")
    void decidedReportsAreFinal() throws Exception {
        User reporter = user("9800000112", "buyer", "Reporter");
        User staff = user("9800000113", "staff", "Ops");

        String created = mvc.perform(post("/reports")
                        .header(HttpHeaders.AUTHORIZATION, bearer(reporter))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetType\":\"property\",\"targetId\":\"p-9\",\"reason\":\"fake\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = created.replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");

        mvc.perform(patch("/reports/{id}", id).header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"dismissed\",\"note\":\"unfounded\"}"))
                .andExpect(status().isOk());

        mvc.perform(patch("/reports/{id}", id).header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"open\"}"))
                .andExpect(status().isConflict());
    }

    // The reporter's identity must not travel with the report into the ops queue.
    @Test
    @DisplayName("the ops queue does not carry the reporter's identity")
    void queueDoesNotLeakReporter() throws Exception {
        User reporter = user("9800000114", "buyer", "Reporter");
        User staff = user("9800000115", "staff", "Ops");

        mvc.perform(post("/reports").header(HttpHeaders.AUTHORIZATION, bearer(reporter))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetType\":\"property\",\"targetId\":\"p-7\",\"reason\":\"spam\"}"))
                .andExpect(status().isCreated());

        String queue = mvc.perform(get("/reports").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(queue).doesNotContain(reporter.getId().toString());
        assertThat(queue).doesNotContain("9800000114");
    }
}
