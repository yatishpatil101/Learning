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
import com.draazy.api.security.Roles;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// Verification thread — participant-or-staff, tested here because a role sweep cannot verify a service-layer rule.
@DisplayName("Verification thread — participant-or-staff, and both halves of a decision")
class VerificationThreadTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
        @Autowired
        com.draazy.api.documents.vault.DocumentRepository documents;

    /** Audit rows are written {@code REQUIRES_NEW} and therefore survive this test's rollback. */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("User " + mobile);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        if (Roles.Wire.STAFF.equals(role)) {
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

    private Property listing(User owner, String deal) {
        Property p = new Property(owner, "2BHK in Kothrud", deal, "apartment", 32000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("rent".equals(deal) ? "per-month" : "total");
        p.setArea(new BigDecimal("900"));
        p.setStatus(PropertyStatus.PENDING);
        p = properties.saveAndFlush(p);
        documents.saveAndFlush(new com.draazy.api.documents.vault.Document(p.getId(), "Not a duplicate of another listing",
                "proof.pdf", "test/verification-proof", 100, "application/pdf"));
        return p;
    }

    private String path(Property p, String suffix) {
        return "/properties/" + p.getId() + "/verification" + suffix;
    }

    private void readyForApproval(Property p, User ops) throws Exception {
        p.setLocalitySlug(jdbc.queryForObject("select slug from localities limit 1", String.class));
        properties.saveAndFlush(p);
        String caseFile = mvc.perform(get(path(p, ""))
                .header(HttpHeaders.AUTHORIZATION, bearer(ops))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> items = com.jayway.jsonpath.JsonPath.read(caseFile, "$.checklist[*].item");
        for (String item : items) {
            mvc.perform(patch(path(p, "/checklist")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"item\":\"" + item + "\",\"pass\":true}"))
                    .andExpect(status().isOk());
        }
    }

    private void hardBrokerSignal(Property p, User reporter) {
        jdbc.update("""
                insert into reports (target_type, target_id, reporter_id, reason, details, status)
                values ('user', ?, ?, 'brokerage', 'broker', 'open'),
                       ('user', ?, ?, 'brokerage', 'broker', 'actioned')
                """, p.getOwner().getId().toString(), reporter.getId(),
                p.getOwner().getId().toString(), reporter.getId());
    }

    private void duplicateConflict(Property p) {
        User other = user("9820000599", Roles.Wire.OWNER);
        p.setElectricityMeterKey("meter-conflict");
        Property duplicate = listing(other, p.getDeal());
        duplicate.setElectricityMeterKey("meter-conflict");
        properties.saveAndFlush(p);
        properties.saveAndFlush(duplicate);
    }

    @Test
    @DisplayName("a stranger gets 404, not 403 — a 403 would confirm the listing exists")
    void aStrangerCannotSeeThatTheCaseExists() throws Exception {
        Property listing = listing(user("9820000501", Roles.Wire.OWNER), "rent");
        String owner = bearer(users.findById(listing.getOwner().getId()).orElseThrow());
        String stranger = bearer(user("9820000502", Roles.Wire.BUYER));

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isCreated());

        mvc.perform(get(path(listing, "")).header(HttpHeaders.AUTHORIZATION, stranger))
                .andExpect(status().isNotFound());
        mvc.perform(post(path(listing, "/messages")).header(HttpHeaders.AUTHORIZATION, stranger)
                .contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"let me in\"}"))
                .andExpect(status().isNotFound());

        mvc.perform(get(path(listing, "")).header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist.length()").value(3));
    }

    @Test
    @DisplayName("new case files use the three-fact checklist for rentals and sales")
    void newCaseFilesUseTheThreeFactChecklist() throws Exception {
        User owner = user("9820000503", Roles.Wire.OWNER);
        Property rental = listing(owner, "rent");
        Property sale = listing(owner, "buy");
        String token = bearer(owner);

        mvc.perform(post(path(rental, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist.length()").value(3));
        mvc.perform(post(path(sale, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist.length()").value(3));

        // Re-submit is idempotent (property_reviews.property_id UNIQUE): row count is the only
        // evidence, since two cases would each carry three lines. properties.flush() first.
        mvc.perform(post(path(rental, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist.length()").value(3));
        properties.flush();
        assertThat(jdbc.queryForObject("select count(*) from property_reviews where property_id = ?",
                Integer.class, rental.getId())).isEqualTo(1);
    }

    @Test
    @DisplayName("'from' is derived server-side, and markRead clears only the other side")
    void theThreadAttributesAndReadsCorrectly() throws Exception {
        User owner = user("9820000504", Roles.Wire.OWNER);
        User ops = user("9820000505", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");
        String ownerToken = bearer(owner);
        String opsToken = bearer(ops);

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, ownerToken))
                .andExpect(status().isCreated());
        mvc.perform(post(path(listing, "/messages")).header(HttpHeaders.AUTHORIZATION, ownerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Index II attached\",\"from\":\"ops\"}"))
                .andExpect(status().isCreated())

                .andExpect(jsonPath("$.messages[0].from").value("owner"));

        mvc.perform(post(path(listing, "/messages")).header(HttpHeaders.AUTHORIZATION, opsToken)
                .contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"Received, reviewing\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.messages[1].from").value("ops"));

        // The owner reads: only ops' message is marked, never their own.
        mvc.perform(post(path(listing, "/read")).header(HttpHeaders.AUTHORIZATION, ownerToken))
                .andExpect(status().isNoContent());
        mvc.perform(get(path(listing, "")).header(HttpHeaders.AUTHORIZATION, ownerToken))
                .andExpect(jsonPath("$.messages[0].read").value(false))
                .andExpect(jsonPath("$.messages[1].read").value(true));
    }

    @Test
        @DisplayName("verification approves the case and publishes the listing in the same act")
    void aDecisionMovesBothHalves() throws Exception {
        User owner = user("9820000506", Roles.Wire.OWNER);
        User ops = user("9820000507", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");
        UUID listingId = listing.getId();

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        readyForApproval(listing, ops);
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"note\":\"docs check out\","
                        + "\"expectedStatus\":\"in_review\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PropertyStatus.APPROVED));

        properties.flush();

        // Both halves move together now: there is no state in which the case file says approved and
        // the listing is still invisible, because that gap had nobody's name on it.
        assertThat(jdbc.queryForObject("select status from properties where id = ?",
                String.class, listingId)).isEqualTo(PropertyStatus.APPROVED);
        assertThat(jdbc.queryForObject("select status from property_reviews where property_id = ?",
                String.class, listingId)).isEqualTo(PropertyStatus.APPROVED);
    }

    @Test
    @DisplayName("a hard broker signal needs a second staff approver")
    void hardSignalApprovalNeedsSecondApprover() throws Exception {
        User owner = user("9820000531", Roles.Wire.OWNER);
        User ops = user("9820000532", Roles.Wire.STAFF);
        User peer = user("9820000533", Roles.Wire.STAFF);
        User poster = user("9820000534", Roles.Wire.STAFF);
        User reporter = user("9820000535", Roles.Wire.BUYER);
        Property listing = listing(owner, "rent");
        listing.markPostedOnBehalf(poster.getId().toString());
        listing.confirmByOwner();
        properties.saveAndFlush(listing);

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        readyForApproval(listing, ops);
        hardBrokerSignal(listing, reporter);

        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"note\":\"checklist passed\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("second_approver_required"));
        mvc.perform(get(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.signals.hardBlock").value(true));

        String response = mvc.perform(post(path(listing, "/override-requests"))
                .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"Hard broker signal reviewed\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.overrideRequest.requestedBy").value(ops.getId().toString()))
                .andReturn().getResponse().getContentAsString();
        String requestId = com.jayway.jsonpath.JsonPath.read(response, "$.overrideRequest.id");

        mvc.perform(post(path(listing, "/override-requests/" + requestId + "/approve"))
                .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"note\":\"same staff\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post(path(listing, "/override-requests/" + requestId + "/approve"))
                .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"note\":\"owner\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post(path(listing, "/override-requests/" + requestId + "/approve"))
                .header(HttpHeaders.AUTHORIZATION, bearer(poster))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"note\":\"poster\"}"))
                .andExpect(status().isForbidden());

        mvc.perform(post(path(listing, "/override-requests/" + requestId + "/approve"))
                .header(HttpHeaders.AUTHORIZATION, bearer(peer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"note\":\"second approval\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"));
        String ownerView = mvc.perform(get(path(listing, ""))
                .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notes").doesNotExist())
                .andExpect(jsonPath("$.messages[0].body")
                        .value("\u2705 Your property has been verified and is now live."))
                .andReturn().getResponse().getContentAsString();
        assertThat(ownerView).doesNotContain("second approval");

        properties.flush();
        assertThat(jdbc.queryForObject("select status from properties where id = ?",
                String.class, listing.getId())).isEqualTo(PropertyStatus.APPROVED);
        assertThat(jdbc.queryForObject("""
                select count(*) from audit_log
                where entity = 'property_override_request'
                  and action in ('property.verification.override.requested',
                                 'property.verification.override.approved')
                  and entity_id = ?
                """, Integer.class, requestId)).isEqualTo(2);
    }

    @Test
    @DisplayName("an unresolved cross-owner duplicate conflict needs a second staff approver")
    void duplicateConflictApprovalNeedsSecondApprover() throws Exception {
        User owner = user("9820000540", Roles.Wire.OWNER);
        User ops = user("9820000541", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");
        duplicateConflict(listing);

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        readyForApproval(listing, ops);

        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("second_approver_required"));
        mvc.perform(post(path(listing, "/override-requests"))
                .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"Cross-owner duplicate reviewed\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.overrideRequest.requestedBy").value(ops.getId().toString()));
    }

    @Test
    @DisplayName("a final rejection reopens only through a second staff approver")
    void finalRejectReversalNeedsSecondApprover() throws Exception {
        User owner = user("9820000536", Roles.Wire.OWNER);
        User ops = user("9820000537", Roles.Wire.STAFF);
        User peer = user("9820000538", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"reject\",\"reasonCode\":\"broker\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("rejected"));
        mvc.perform(patch("/properties/{id}/status", listing.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"pending\",\"reason\":\"appeal accepted\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("second_approver_required"));

        String response = mvc.perform(post(path(listing, "/override-requests"))
                .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"Owner appeal has evidence\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String requestId = com.jayway.jsonpath.JsonPath.read(response, "$.overrideRequest.id");

        mvc.perform(post(path(listing, "/override-requests/" + requestId + "/approve"))
                .header(HttpHeaders.AUTHORIZATION, bearer(peer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"note\":\"reopen\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("in_review"));

        properties.flush();
        assertThat(jdbc.queryForObject("select status from properties where id = ?",
                String.class, listing.getId())).isEqualTo(PropertyStatus.PENDING);
        assertThat(jdbc.queryForObject("select status from property_reviews where property_id = ?",
                String.class, listing.getId())).isEqualTo(PropertyStatus.PENDING);
    }

    @Test
    @DisplayName("a decision writes its own explanation into the thread, attributed to ops")
    void aDecisionExplainsItselfInTheThread() throws Exception {
        User owner = user("9820000512", Roles.Wire.OWNER);
        User ops = user("9820000513", Roles.Wire.STAFF);
        Property approved = listing(owner, "rent");
        Property rejected = listing(owner, "rent");

        mvc.perform(post(path(approved, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        readyForApproval(approved, ops);
        mvc.perform(post(path(approved, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"note\":\"Index II matched.\"}"))
                .andExpect(status().isOk())

                // "ops" is derived from the sender like every other message, not hard-coded on the
                // decision path — so a staff member deciding cannot be rendered as the owner.
                .andExpect(jsonPath("$.messages[0].from").value("ops"))

                // Non-null only because decide() flushes: id and createdAt are assigned at insert.
                .andExpect(jsonPath("$.messages[0].id").isNotEmpty())
                .andExpect(jsonPath("$.messages[0].body")
                        .value("\u2705 Your property has been verified and is now live."
                                + " Index II matched."));

        mvc.perform(post(path(rejected, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(rejected, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"reject\"}"))
                .andExpect(status().isUnprocessableEntity());
        mvc.perform(post(path(rejected, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"reject\",\"reasonCode\":\"document_unreadable\","
                        + "\"note\":\"The Index II is illegible.\"}"))
                .andExpect(status().isOk());
        mvc.perform(get(path(rejected, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].body").value(
                        "\u26D4 Your property could not be approved.\nReason: Please upload a readable document."
                                + " The Index II is illegible."));
    }

    @Test
    @DisplayName("needs_info pauses the case until the owner replies")
    void needsInfoOwnerReplyResubmits() throws Exception {
        User owner = user("9820000523", Roles.Wire.OWNER);
        User ops = user("9820000524", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(patch(path(listing, "/checklist")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"item\":\"Photos are real and match the listing\",\"pass\":true}"))
                .andExpect(status().isOk());
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"needs_info\",\"reasonCode\":\"photos_not_real\","
                        + "\"note\":\"Use current photos.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("needs_info"))
                .andExpect(jsonPath("$.reasonCode").value("photos_not_real"))
                .andExpect(jsonPath("$.reasonNote").value("Use current photos."))
                .andExpect(jsonPath("$.progress.flags").value(org.hamcrest.Matchers.hasItem("needs_info")))
                .andExpect(jsonPath("$.checklist[?(@.item == 'Photos are real and match the listing')].pass")
                        .value(false));

        mvc.perform(post(path(listing, "/messages")).header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Uploaded current photos.\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("in_review"))
                .andExpect(jsonPath("$.progress.step").value("in_review"))
                .andExpect(jsonPath("$.progress.flags").isEmpty());
    }

    @Test
    @DisplayName("needs_info tells the owner, with the reviewer's reason and note, and nobody else")
    void needsInfoNotifiesOnlyTheOwner() throws Exception {
        User owner = user("9820000571", Roles.Wire.OWNER);
        User ops = user("9820000572", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"needs_info\",\"reasonCode\":\"photos_not_real\","
                        + "\"note\":\"Use current photos.\"}"))
                .andExpect(status().isOk());

        assertThat(jdbc.queryForList(
                "select type, title, body, link from notifications where user_id = ? and type like 'listing.%'",
                owner.getId())).singleElement().satisfies(row -> {
                    assertThat(row.get("type")).isEqualTo("listing.needs_info");
                    assertThat(row.get("title")).isEqualTo("Your listing needs info");
                    assertThat(row.get("body")).isEqualTo(
                            "Please add clear photos of the actual property. Use current photos.");
                    assertThat(row.get("link")).isEqualTo("/dashboard?review=" + listing.getId());
                });
        assertThat(jdbc.queryForObject("select count(*) from notifications where user_id = ?",
                Integer.class, ops.getId())).isZero();
    }

    @Test
    @DisplayName("staff can decide a needs-info case after the owner fixes it")
    void staffCanDecideAfterNeedsInfo() throws Exception {
        User owner = user("9820000560", Roles.Wire.OWNER);
        User ops = user("9820000561", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"needs_info\",\"reasonCode\":\"photos_not_real\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("needs_info"));
        readyForApproval(listing, ops);
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"expectedStatus\":\"needs_info\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"));
    }

    @Test
    @DisplayName("staff clarification requests become needs-info decisions")
    void staffClarificationRequestBecomesNeedsInfo() throws Exception {
        User owner = user("9820000562", Roles.Wire.OWNER);
        User ops = user("9820000563", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(listing, "/messages")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Please upload a readable sale deed.\","
                        + "\"clarificationRequested\":true}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("needs_info"))
                .andExpect(jsonPath("$.reasonCode").value("other"))
                .andExpect(jsonPath("$.reasonNote").value("Please upload a readable sale deed."))
                .andExpect(jsonPath("$.progress.flags").value(org.hamcrest.Matchers.hasItem("needs_info")));
    }

    @Test
    @DisplayName("a final rejection is not reopened by an owner message")
    void rejectedOwnerMessageDoesNotResubmit() throws Exception {
        User owner = user("9820000525", Roles.Wire.OWNER);
        User ops = user("9820000526", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"reject\",\"reasonCode\":\"broker\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("rejected"));
        mvc.perform(post(path(listing, "/messages")).header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"I am the owner.\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("rejected"));

        properties.flush();
        assertThat(jdbc.queryForObject("select status from properties where id = ?",
                String.class, listing.getId())).isEqualTo(PropertyStatus.REJECTED);
    }

    @Test
    @DisplayName("expectedStatus detects stale decisions before any verdict is written")
    void expectedStatusRejectsStaleDecision() throws Exception {
        User owner = user("9820000527", Roles.Wire.OWNER);
        User ops = user("9820000528", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"expectedStatus\":\"approved\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("stale_decision"));
    }

    @Test
    @DisplayName("reasonCode is validated for needs_info and reject")
    void reasonCodeIsValidated() throws Exception {
        User owner = user("9820000529", Roles.Wire.OWNER);
        User ops = user("9820000530", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"needs_info\",\"reasonCode\":\"wat\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid_reason_code"));
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"reject\",\"reasonCode\":\"other\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("reason_note_required"));
    }

    // Deciding must drain `recheck_requested_at`.
    // Both verdicts because `approve` clears `flagReason`, tempting a fix that leaves `reject` stranding the row.
    @Test
    @DisplayName("either verdict clears a pending stays-live re-check")
    void aDecisionClearsThePendingRecheck() throws Exception {
        User owner = user("9820000514", Roles.Wire.OWNER);
        User ops = user("9820000515", Roles.Wire.STAFF);

        for (String decision : List.of("approve", "reject")) {
            Property listing = listing(owner, "rent");
            listing.setStatus(PropertyStatus.APPROVED);
            listing.requestRecheck(List.of("price"));
            properties.saveAndFlush(listing);

            // requestRecheck is a no-op on a non-public listing, so asserting the queue actually
            // has something to drain guards against a fixture that silently queues nothing.
            assertThat(listing.isRecheckPending())
                    .as("the fixture did not queue a re-check to begin with")
                    .isTrue();

            mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isCreated());
            readyForApproval(listing, ops);
            mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"decision\":\"" + decision + "\",\"reasonCode\":\"wrong_details\","
                            + "\"note\":\"re-checked\"}"))
                    .andExpect(status().isOk());

            properties.flush();
            assertThat(jdbc.queryForObject(
                    "select recheck_requested_at from properties where id = ?",
                    java.sql.Timestamp.class, listing.getId()))
                    .as("a listing a checker has just %sd is still sitting in the re-check queue",
                            decision)
                    .isNull();
        }
    }

    @Test
    @DisplayName("staff cannot decide the verification of a listing they own")
    void staffCannotDecideTheirOwnListing() throws Exception {
        User staff = user("9820000508", Roles.Wire.STAFF);
        Property own = listing(staff, "rent");
        String token = bearer(staff);

        mvc.perform(post(path(own, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated());
        mvc.perform(post(path(own, "/decision")).header(HttpHeaders.AUTHORIZATION, token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"approve\"}"))
                .andExpect(status().isForbidden());

        properties.flush();
        assertThat(jdbc.queryForObject("select status from properties where id = ?",
                String.class, own.getId())).isEqualTo(PropertyStatus.PENDING);
    }

    // What matters is a second reviewer seeing it.
    @Test
    @DisplayName("a tick persists, is addressed by item text, and the next reviewer sees it")
    void tickingAChecklistLineOutlivesTheReviewersSession() throws Exception {
        User owner = user("9820000514", Roles.Wire.OWNER);
        User ops = user("9820000515", Roles.Wire.STAFF);
        User colleague = user("9820000516", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())

                // Baseline stated positively — a filter for ticked lines returning nothing is
                // also what an absent checklist returns.
                .andExpect(jsonPath("$.checklist.length()").value(3))
                .andExpect(jsonPath("$.checklist[?(@.item == 'Photos are real and match the listing')].pass")
                        .value(false));

        mvc.perform(patch(path(listing, "/checklist")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"item\":\"Photos are real and match the listing\",\"pass\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[?(@.item == 'Photos are real and match the listing')].pass")
                        .value(true))
                .andExpect(jsonPath("$.checklist[?(@.item == 'Not a duplicate of another listing')].pass")
                        .value(false));

        mvc.perform(get(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(colleague)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[?(@.item == 'Photos are real and match the listing')].pass")
                        .value(true));

        properties.flush();
        assertThat(jdbc.queryForObject(
                "select pass from property_review_checklist c join property_reviews r on r.id = c.review_id"
                        + " where r.property_id = ? and c.item = ?",
                Boolean.class, listing.getId(), "Photos are real and match the listing")).isTrue();
        Map<String, Object> attribution = jdbc.queryForMap(
                "select checked_by, checked_at from property_review_checklist c"
                        + " join property_reviews r on r.id = c.review_id"
                        + " where r.property_id = ? and c.item = ?",
                listing.getId(), "Photos are real and match the listing");
        assertThat(attribution.get("checked_by").toString()).isEqualTo(ops.getId().toString());
        assertThat(attribution.get("checked_at")).isNotNull();
        assertThat(jdbc.queryForObject("""
                select count(*) from audit_log
                where actor = ? and action = 'property.verification.checklist'
                  and entity_id = ? and metadata->>'item' = ?
                  and metadata->>'pass' = 'true'
                """, Integer.class, ops.getId().toString(), listing.getId().toString(),
                "Photos are real and match the listing")).isEqualTo(1);

        // Unticking is the same call — a reviewer who ticked the wrong line must be able to undo it
        // without reopening the case.
        mvc.perform(patch(path(listing, "/checklist")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"item\":\"Photos are real and match the listing\",\"pass\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[?(@.item == 'Photos are real and match the listing')].pass")
                        .value(false));

        mvc.perform(patch(path(listing, "/checklist")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"item\":\"Encumbrance certificate\",\"pass\":true}"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("staff cannot tick the checklist of a listing they own")
    void staffCannotMarkTheirOwnHomework() throws Exception {
        User staff = user("9820000517", Roles.Wire.STAFF);
        Property own = listing(staff, "rent");
        String token = bearer(staff);

        mvc.perform(post(path(own, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated());
        mvc.perform(patch(path(own, "/checklist")).header(HttpHeaders.AUTHORIZATION, token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"item\":\"Photos are real and match the listing\",\"pass\":true}"))
                .andExpect(status().isForbidden());
    }

    // No role guard here; owner filtering is the only protection between case files.
    @Test
    @DisplayName("the owner queue never names the reviewer")
    void ownerQueueDoesNotNameTheReviewer() throws Exception {
        User owner = user("9820000521", Roles.Wire.OWNER);
        User ops = user("9820000522", Roles.Wire.STAFF);
        Property mine = listing(owner, "rent");
        mvc.perform(post(path(mine, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(mine, "/start")).header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk());

        mvc.perform(get("/me/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].reviewer").doesNotExist())
                .andExpect(jsonPath("$.content[0].reviewerName").doesNotExist());
    }

    @Test
    @DisplayName("the owner queue returns only my listings, with ops' unread messages counted")
    void ownerQueueIsScopedToTheCallerAndCountsTheOtherSide() throws Exception {
        User owner = user("9820000518", Roles.Wire.OWNER);
        User stranger = user("9820000519", Roles.Wire.OWNER);
        User ops = user("9820000520", Roles.Wire.STAFF);
        Property mine = listing(owner, "rent");
        Property theirs = listing(stranger, "rent");

        mvc.perform(post(path(mine, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(theirs, "")).header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isCreated());

        // One message each way. Only the ops one should count towards the owner's badge — a badge
        // that counted your own sent messages would never clear.
        mvc.perform(post(path(mine, "/messages")).header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Uploaded the bill.\"}"))
                .andExpect(status().isCreated());
        mvc.perform(post(path(mine, "/messages")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Thanks, checking now.\"}"))
                .andExpect(status().isCreated());

        mvc.perform(get("/me/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].propertyId").value(mine.getId().toString()))
                .andExpect(jsonPath("$.content[0].unread").value(1));

        String waiting = "$.ownerReplies.items[?(@.propertyId == '" + mine.getId() + "')]";
        mvc.perform(get("/admin/bell").header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath(waiting).isNotEmpty());

        // Reading clears one side only — the assertion that would catch {@code markRead} being
        // widened to every message and silently clearing the badge the other side is waiting on.
        mvc.perform(post(path(mine, "/read")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());
        mvc.perform(get("/me/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].unread").value(0));
        mvc.perform(get("/admin/bell").header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath(waiting).isNotEmpty());

        mvc.perform(get("/me/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));
    }

    @Test
    @DisplayName("a moderation queue row says whether the owner's last word is still unread by staff")
    void queueRowsFlagAnOwnerReply() throws Exception {
        User owner = user("9820000521", Roles.Wire.OWNER);
        User ops = user("9820000522", Roles.Wire.STAFF);
        Property replied = listing(owner, "rent");
        Property quiet = listing(owner, "rent");
        for (Property p : List.of(replied, quiet)) {
            mvc.perform(post(path(p, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isCreated());
        }
        mvc.perform(post(path(replied, "/messages")).header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Here is the bill.\"}"))
                .andExpect(status().isCreated());

        mvc.perform(get("/admin/properties").param("size", "100")
                        .header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id == '" + replied.getId() + "')].ownerReplied")
                        .value(true))
                .andExpect(jsonPath("$.content[?(@.id == '" + quiet.getId() + "')].ownerReplied")
                        .value(false));
    }}
