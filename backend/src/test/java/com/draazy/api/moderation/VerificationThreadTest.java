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
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Verification thread — participant-or-staff, tested here because a role sweep cannot verify a
 * service-layer rule. Denials answer 404 so the code is not an existence oracle.
 */
@DisplayName("Verification thread — participant-or-staff, and both halves of a decision")
class VerificationThreadTest extends AbstractApiTest {

        private static final String ADMIN_PROPERTY_REVIEWS = "/admin/property-reviews";

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
        documents.saveAndFlush(new com.draazy.api.documents.vault.Document(p.getId(), "Index II",
                "proof.pdf", "test/verification-proof", 100, "application/pdf"));
        return p;
    }

    private String path(Property p, String suffix) {
        return "/properties/" + p.getId() + "/verification" + suffix;
    }

    /**
     * Everything an approval needs beyond the reviewer's intent: a locality to be filed under, and every checklist
     * line ticked. Both are refused with a 409, so a fixture that skips this asserts against an unintended conflict.
     */
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

        // The owner, by contrast, reads their own case file.
        mvc.perform(get(path(listing, "")).header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist.length()").value(3));
    }

    @Test
    @DisplayName("the checklist is the rent one for a rental and the longer buy one for a sale")
    void theChecklistMatchesTheDeal() throws Exception {
        User owner = user("9820000503", Roles.Wire.OWNER);
        Property rental = listing(owner, "rent");
        Property sale = listing(owner, "buy");
        String token = bearer(owner);

        mvc.perform(post(path(rental, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist.length()").value(3));
        mvc.perform(post(path(sale, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist.length()").value(6));

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
                // A client-supplied "from" is ignored: it is derived from the authenticated sender,
                // or an owner could post as ops in their own case file.
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
    @DisplayName("staff can list verification case files; owner cannot")
    void verificationQueueIsStaffScopedAndPaged() throws Exception {
        User owner = user("9820000510", Roles.Wire.OWNER);
        User staff = user("9820000511", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());

        mvc.perform(get(ADMIN_PROPERTY_REVIEWS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].propertyId").value(listing.getId().toString()))
                .andExpect(jsonPath("$.content[0].status").value("pending"));

        mvc.perform(get(ADMIN_PROPERTY_REVIEWS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isForbidden());
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
                .content("{\"decision\":\"approve\",\"note\":\"docs check out\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PropertyStatus.APPROVED));

        properties.flush();
        // Both halves move together now: there is no state in which the case file says approved and
        // the listing is still invisible, because that gap had nobody's name on it.
        assertThat(jdbc.queryForObject("select status from properties where id = ?",
                String.class, listingId)).isEqualTo(PropertyStatus.APPROVED);
        assertThat(jdbc.queryForObject("select lifecycle_stage from properties where id = ?",
                String.class, listingId)).isEqualTo("live");
        assertThat(jdbc.queryForObject("select status from property_reviews where property_id = ?",
                String.class, listingId)).isEqualTo(PropertyStatus.APPROVED);
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

        // Rejection is read back by the *owner*, so the sentence is a persisted row rather than console paint.
        // A reason is mandatory — a rejection with nothing to act on is a dead end.
        mvc.perform(post(path(rejected, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(rejected, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"reject\"}"))
                .andExpect(status().isUnprocessableEntity());
        mvc.perform(post(path(rejected, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"reject\",\"note\":\"The Index II is illegible.\"}"))
                .andExpect(status().isOk());
        mvc.perform(get(path(rejected, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].body").value(
                        "\u26D4 Your property could not be approved.\nReason: The Index II is"
                                + " illegible.\nPlease address this and reply here to resubmit."));
    }

    /**
     * Deciding must drain {@code recheck_requested_at}. Both verdicts because {@code approve}
     * clears {@code flagReason}, tempting a fix that leaves {@code reject} stranding the row.
     */
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
                    .content("{\"decision\":\"" + decision + "\",\"note\":\"re-checked\"}"))
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

    /**
     * Checklist was seeded at {@code initiate} and never read back, so every tick lived only in the
     * reviewer's browser. What matters is a <em>second</em> reviewer seeing it.
     */
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
                .andExpect(jsonPath("$.checklist[?(@.item == 'Electricity bill')].pass").value(false));

        mvc.perform(patch(path(listing, "/checklist")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"item\":\"Electricity bill\",\"pass\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[?(@.item == 'Electricity bill')].pass").value(true))
                .andExpect(jsonPath("$.checklist[?(@.item == 'Index II')].pass").value(false));

        // A different staff member, a different session, a different request.
        mvc.perform(get(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(colleague)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[?(@.item == 'Electricity bill')].pass").value(true));

        // Read the column via JdbcTemplate: same persistence context means the response reads
        // would pass even if the tick never left memory, and JdbcTemplate skips Hibernate's auto-flush.
        properties.flush();
        assertThat(jdbc.queryForObject(
                "select pass from property_review_checklist c join property_reviews r on r.id = c.review_id"
                        + " where r.property_id = ? and c.item = ?",
                Boolean.class, listing.getId(), "Electricity bill")).isTrue();

        // Unticking is the same call — a reviewer who ticked the wrong line must be able to undo it
        // without reopening the case.
        mvc.perform(patch(path(listing, "/checklist")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"item\":\"Electricity bill\",\"pass\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[?(@.item == 'Electricity bill')].pass").value(false));

        // An item that is not on this deal's list is a 404, not a silent no-op: a console ticking a
        // line the server has never heard of is out of step with the case file and should be told.
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
                .content("{\"item\":\"Index II\",\"pass\":true}"))
                .andExpect(status().isForbidden());
    }

    /**
     * The one queue route with no role guard, so a wrong owner filter would hand every owner
     * every other owner's case files.
     */
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

        // The same page, from the desk's end: the owner's message is the one waiting on ops.
        mvc.perform(get("/admin/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.propertyId == '" + mine.getId() + "')].unread")
                        .value(1));

        // Reading clears one side only — the assertion that would catch {@code markRead} being
        // widened to every message and silently clearing the badge the other side is waiting on.
        mvc.perform(post(path(mine, "/read")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());
        mvc.perform(get("/me/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].unread").value(0));
        mvc.perform(get("/admin/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.propertyId == '" + mine.getId() + "')].unread")
                        .value(1));

        // A user with no listings gets an empty page, not a 403: nothing here is privileged.
        mvc.perform(get("/me/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));
    }
}
