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

/**
 * The three properties a role guard alone does not give you: a guard says who may act, not whether the action was
 * recorded, whether the actor could act on <em>that row</em>, or whether one request can drain the database.
 */
@DisplayName("Moderation — accountability, self-dealing and blast radius")
class ModerationBehaviourTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /**
     * Audit writes run {@code REQUIRES_NEW} so they survive a rolled-back business transaction — and so they
     * escape this test's rollback too. Hence assertions scoped to an entity id, and explicit cleanup.
     */
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
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Baner", "rent", "apartment", 28000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        p.setStatus(PropertyStatus.PENDING);
        // Filed under a curated area, since saving through the repository skips LocalityResolver and approval
        // refuses an unfiled listing — a fixture tripping a guard it never mentions gets "fixed" by weakening it.
        p.setLocalitySlug("baner");
        return properties.saveAndFlush(p);
    }

    /** Audit rows for one action <em>on one specific entity</em> — never the whole action. */
    private List<Map<String, Object>> auditRows(String action, Object entityId) {
        return jdbc.queryForList(
                "select * from audit_log where action = ? and entity_id = ? order by at desc",
                action, String.valueOf(entityId));
    }

    // ---------------------------------------------------------------- accountability

    /**
     * The endpoint existing is not the feature, the writes are: asserts the audit row happens and that the actor
     * recorded is the token's subject rather than anything the client sent.
     */
    @Test
    @DisplayName("approving a listing writes an audit row naming the server-resolved actor")
    void moderationIsAudited() throws Exception {
        User owner = user("9800000101", "owner", "Owner");
        User staff = user("9800000102", "staff", "Ops");
        Property listing = listing(owner);

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
        // Read the document back through Postgres' own jsonb accessors rather than by substring:
        // jsonb is stored normalised, so a text comparison would be asserting on formatting.
        assertThat(metadataField(rows.get(0), "from")).isEqualTo("pending");
        assertThat(metadataField(rows.get(0), "to")).isEqualTo("approved");
        assertThat(metadataField(rows.get(0), "reason")).isEqualTo("docs verified");
    }

    private String metadataField(Map<String, Object> auditRow, String key) {
        return jdbc.queryForObject("select metadata->>? from audit_log where id = ?",
                String.class, key, auditRow.get("id"));
    }

    /**
     * The queue approves as submitted and never opens the case file, so the record has to say which route
     * decided. The checklist stays unticked on purpose — that is the whole difference between the two.
     */
    @Test
    @DisplayName("a queue approval closes the case file it never opened, without forging the checklist")
    void queueApprovalDecidesTheCaseFile() throws Exception {
        User owner = user("9800000141", "owner", "Owner");
        User staff = user("9800000142", "staff", "Ops");
        Property listing = listing(owner);

        // Open the case file the way the verification tab does, then decide from the queue instead.
        mvc.perform(post("/properties/{id}/verification/start", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk());
        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"looks fine as submitted\"}"))
                .andExpect(status().isOk());

        Map<String, Object> review = jdbc.queryForMap(
                "select * from property_reviews where property_id = ?", listing.getId());
        assertThat(review.get("status")).isEqualTo(PropertyStatus.APPROVED);
        assertThat(review.get("reviewer")).isEqualTo(staff.getId().toString());
        assertThat(review.get("decided_at")).isNotNull();
        assertThat((String) review.get("notes")).contains("without the document checklist")
                .contains("looks fine as submitted");
        assertThat(jdbc.queryForObject(
                "select count(*) from property_review_checklist i join property_reviews r"
                        + " on i.review_id = r.id where r.property_id = ? and i.pass",
                Integer.class, listing.getId()))
                .as("a queue approval must not tick evidence nobody looked at")
                .isZero();
    }

    /**
     * A listing nobody opened a case file for has no contradiction to resolve. Creating one per row would file a
     * six-line unticked checklist for every listing in a bulk approve, saying only that nothing happened.
     */
    @Test
    @DisplayName("a queue approval does not open a case file just to close it")
    void queueApprovalInventsNoCaseFile() throws Exception {
        User owner = user("9800000143", "owner", "Owner");
        User staff = user("9800000144", "staff", "Ops");
        Property listing = listing(owner);

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());

        assertThat(jdbc.queryForObject("select count(*) from property_reviews where property_id = ?",
                Integer.class, listing.getId())).isZero();
    }

    /**
     * Clearing a re-check is a {@code PATCH .../status} like any other, so the rule above would overwrite the
     * reviewer who read the documents. A standing verdict the new status agrees with is left alone.
     */
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
        // Ticked through the endpoint, not with an UPDATE: the rows are already in this transaction's
        // persistence context, so raw SQL would leave them cached as false and the approval would 409.
        for (String item : List.of("Index II", "Electricity bill", "Aadhaar card")) {
            mvc.perform(patch("/properties/{id}/verification/checklist", listing.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"item\":\"" + item + "\",\"pass\":true}"))
                    .andExpect(status().isOk());
        }
        mvc.perform(post("/properties/{id}/verification/decision", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"approve\",\"note\":\"deed and tax receipt seen\"}"))
                .andExpect(status().isOk());

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(other))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"Owner edits reviewed\"}"))
                .andExpect(status().isOk());

        Map<String, Object> review = jdbc.queryForMap(
                "select * from property_reviews where property_id = ?", listing.getId());
        assertThat(review.get("reviewer")).isEqualTo(desk.getId().toString());
        assertThat(review.get("notes")).isEqualTo("deed and tax receipt seen");
    }

    /**
     * Both terminal verdicts are announced to the owner and the rejection reason travels with it; the moderator
     * hears nothing. Notifications share the business transaction, so they roll back and need no cleanup.
     */
    @Test
    @DisplayName("a moderation verdict notifies the listing's owner, approve and reject")
    void moderationNotifiesTheOwner() throws Exception {
        User owner = user("9800000131", "owner", "Owner");
        User staff = user("9800000132", "staff", "Ops");
        Property approved = listing(owner);
        Property rejected = listing(owner);

        mvc.perform(patch("/properties/{id}/status", approved.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());
        mvc.perform(patch("/properties/{id}/status", rejected.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"rejected\",\"reason\":\"blurry photos\"}"))
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

    /**
     * A moderator's note is operator free text landing in jsonb, so hand-built JSON would let a quote forge
     * fields in the one table that exists to be trusted.
     */
    @Test
    @DisplayName("a quote in a moderator's note cannot corrupt or forge the audit metadata")
    void auditMetadataIsInjectionProof() throws Exception {
        User owner = user("9800000103", "owner", "Owner");
        User staff = user("9800000104", "staff", "Ops");
        Property listing = listing(owner);

        mvc.perform(patch("/properties/{id}/status", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"rejected\",\"reason\":\"said \\\"fake\\\", to\\\":\\\"approved\"}"))
                .andExpect(status().isOk());

        Map<String, Object> row = auditRows("property.status", listing.getId()).get(0);
        // Read back through Postgres' own jsonb parser: if the document were corrupt the insert
        // would have failed, and if the note had escaped its string the ->> would return the forgery.
        String to = jdbc.queryForObject("select metadata->>'to' from audit_log where id = ?",
                String.class, row.get("id"));
        assertThat(to).isEqualTo("rejected");
        String reason = jdbc.queryForObject("select metadata->>'reason' from audit_log where id = ?",
                String.class, row.get("id"));
        assertThat(reason).contains("said \"fake\"");
    }

    // ---------------------------------------------------------------- self-dealing

    /**
     * Roles are additive, so a staff member is also a user who can list a flat. The cheapest abuse is approving
     * and featuring your own listing — and its audit row looks entirely ordinary.
     */
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

        mvc.perform(post("/properties/{id}/toggle-featured", own.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isForbidden());

        assertThat(auditRows("property.status", own.getId())).isEmpty();
    }

    /**
     * The one moderation action that destroys the ability to undo itself: only admins can restore a user, so a
     * self-archiving admin locks the back office permanently on a single-admin platform.
     */
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

    // ---------------------------------------------------------------- PII blast radius

    /**
     * Ops need a phone number to act on a case, but a paged list is a bulk-export surface dressed as a search
     * screen. One deliberate, logged read per person makes exfiltration linear and leaves a trail.
     */
    @Test
    @DisplayName("the user list masks mobiles; the detail read reveals and is audited")
    void mobileIsMaskedOnListAndAuditedOnReveal() throws Exception {
        User staff = user("9800000107", "staff", "Ops");
        User subject = user("9800000108", "buyer", "Subject");

        mvc.perform(get("/users").param("q", "Subject")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].mobile").value(org.hamcrest.Matchers.not("9800000108")));

        assertThat(auditRows("user.contact.reveal", subject.getId())).isEmpty();

        mvc.perform(get("/users/{id}", subject.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mobile").value("9800000108"));

        List<Map<String, Object>> rows = auditRows("user.contact.reveal", subject.getId());
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("actor")).isEqualTo(staff.getId().toString());
        assertThat(rows.get(0).get("entity_id")).isEqualTo(subject.getId().toString());
    }

    // ---------------------------------------------------------------- blast radius

    /**
     * Every signed-in user can add to the report queue and only ops can take anything out. An uncapped
     * {@code size} is a one-request database dump; an unhandled {@code sort} on a server-ordered query is a 500.
     */
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

    /**
     * Anchored on purpose: without {@code pg_trgm} the {@code text_pattern_ops} indexes serve prefixes only, and
     * an unescaped {@code %} in the caller's term smuggles a wildcard past the anchor into a full-table scan.
     */
    @Test
    @DisplayName("a wildcard in the search term is matched literally, not interpreted")
    void searchWildcardsAreNeutralised() throws Exception {
        User staff = user("9800000111", "staff", "Ops");
        user("9800000112", "buyer", "Wildcard Target");

        // '%' alone would match every row if it reached Postgres as a wildcard.
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

    // ---------------------------------------------------------------- the abuse queue

    /**
     * Anyone signed in may file, so without the guard one user buries a rival by repeating a complaint and ops
     * read volume as consensus. The service checks first; a partial UNIQUE index catches the concurrent pair.
     */
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

    /**
     * The reason vocabulary is per-target-type: {@code brokerage} means something about a person and nothing
     * about a listing, so a flat CHECK over the union would accept every nonsensical pairing.
     */
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

    /**
     * Triage is the only verb that moves a report out of {@code open}. A decided report is never reopened:
     * that would let a moderator relitigate a colleague's decision with no new evidence and no new row.
     */
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

    /**
     * The reporter's identity must not travel with the report into the ops queue. Ops act on what was
     * alleged, not on who alleged it — and a queue that names reporters is a queue that leaks them.
     */
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
