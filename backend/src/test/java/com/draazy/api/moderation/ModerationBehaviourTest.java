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
 * Behaviour proof for the moderation slice: what the guards let through must also be
 * <em>accountable</em>, <em>self-limiting</em> and <em>bounded</em>.
 *
 * <p>The three properties tested here are the ones a role guard alone does not give you. A guard
 * says who may act; it says nothing about whether the action was recorded, whether the actor was
 * allowed to act on <em>that particular row</em>, or whether one request can drain the database.
 */
@DisplayName("Moderation — accountability, self-dealing and blast radius")
class ModerationBehaviourTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /**
     * Audit writes run in {@code REQUIRES_NEW} — deliberately, so an attempted privileged action is
     * recorded even when the surrounding business transaction rolls back. The consequence for tests
     * is easy to miss and would have made this class quietly order-dependent: the rows <em>escape
     * the test's own rollback</em> and persist in the database afterwards. So every assertion below
     * is scoped to a specific entity id rather than to an action name, and the rows are cleaned up
     * explicitly here.
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
        // Filed under a curated area, as a listing whose free text resolved would be. Saving through
        // the repository skips LocalityResolver, so without this every fixture here is an *unfiled*
        // listing — and approval now refuses those (register item 24). Approving one is not what any
        // test in this class is about, and a fixture that trips a guard it never mentions is a
        // fixture that will be "fixed" by weakening the guard.
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
     * {@code AuditService} shipped in slice 1 and had <strong>zero callers</strong> until this slice,
     * so {@code GET /admin/audit-log} would have returned an empty page forever. The endpoint existing
     * is not the feature; the writes are. This asserts the write happens and that the actor recorded
     * is the token's subject rather than anything the client sent.
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
     * Approving or rejecting a listing tells its owner (tech-debt D92) — until this writer nothing
     * did, so an owner learned their listing's fate only by revisiting the dashboard. Both terminal
     * verdicts are announced and the rejection reason travels with it; the moderator is told nothing
     * about their own decision. Notifications share the business transaction, so unlike the audit
     * rows above they roll back with the test and need no cleanup.
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
     * A moderator's note is operator-supplied free text landing in a jsonb column. Hand-built JSON
     * was the obvious shortcut here and would have let a quote in a note forge fields inside the one
     * table that exists to be trusted — so this asserts the note survives a quote intact and that the
     * surrounding document is still parseable with its other keys unharmed.
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
     * Roles are additive: a staff member is also a user who can list a flat. Without an explicit
     * check, the cheapest abuse of the role is to approve and feature your own listing — and the
     * audit row it produces looks entirely ordinary, so nothing downstream would catch it.
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
     * The one moderation action that can destroy the ability to undo itself: only admins can restore
     * a user, so an admin archiving itself on a single-admin platform locks the back office
     * permanently, with no in-product recovery.
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
     * The list/detail asymmetry (D9.2). Ops genuinely need a phone number to act on a case, so
     * refusing it entirely would push the work off-platform — but a paged list hands over a page of
     * numbers per click, which is a bulk-export surface wearing the clothes of a search screen.
     * Requiring one deliberate, individually-logged read per person makes exfiltration cost linear in
     * the number of people exfiltrated and leaves a trail naming each one.
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
     * Both back-office lists are new growth surfaces — every signed-in user can add to the report
     * queue and only ops can take anything out of it. An uncapped {@code size} on either is a
     * one-request database dump; an unhandled {@code sort} on a server-ordered query is a 500.
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
     * The user search is anchored on purpose: there is no {@code pg_trgm}, so V18's
     * {@code text_pattern_ops} indexes serve prefix matches and nothing else. The caller supplies the
     * term and the server appends the {@code %} — so an unescaped {@code %} or {@code _} in the term
     * would smuggle the caller's own wildcards past the anchor, turning a staff-callable endpoint
     * into an unindexed scan of every user on the platform. A page cap does not help: the scan
     * happens before the limit does.
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
     * The queue is the platform's most abusable write: anyone signed in may file. Without the guard,
     * one user can bury a rival by filing the same complaint repeatedly, and ops see a queue whose
     * volume is indistinguishable from genuine consensus. The service checks first and V18's partial
     * UNIQUE index catches the concurrent pair the check cannot.
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
     * The reason vocabulary is per-target-type, not a flat union (D9.3). {@code brokerage} is a
     * meaningful complaint about a person and meaningless about a listing; a flat CHECK over the
     * union would accept every nonsensical pairing while appearing to validate.
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
     * Triage was added to the contract in spec fix S30 because the queue had no verb capable of
     * moving a report out of {@code open} — a four-state status nothing could set. A decided report
     * is never reopened: reopening would let a moderator quietly relitigate a colleague's decision
     * with no new evidence and no new row.
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
