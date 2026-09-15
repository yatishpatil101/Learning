package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.moderation.report.Report;
import com.draazy.api.moderation.report.ReportRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * A report moved to {@code actioned} with an enforcement must leave the target in a different state,
 * in the same transaction, with the acting moderator named on it.
 */
@DisplayName("Report triage — the decision reaches the thing that was reported")
class ReportEnforcementTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ReportRepository reports;

    /** Audit writes run {@code REQUIRES_NEW} and commit past rollback; wipe them per-actor to keep the class order-independent. */
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
        // Staff without a desk are refused outright; the seeded document grants all six the same
        // set, so which one is immaterial here.
        if (Roles.Wire.STAFF.equals(role)) u.setTeam(Teams.RENTAL);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Baner", "rent", "apartment", 28000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }

    private Report report(String targetType, String targetId, User reporter, String reason) {
        return reports.saveAndFlush(
                new Report(targetType, targetId, reporter.getId(), reason, "details"));
    }

    private String triage(String status, String enforcement) {
        return """
                {"status":"%s","note":"upheld","enforcement":"%s"}""".formatted(status, enforcement);
    }

    // ------------------------------------------------------------------ authorisation

    /**
     * Reading the queue is ops-only; acting on it more so. A buyer reaching either verb would learn
     * every complaint on the platform and could decide them.
     */
    @Test
    @DisplayName("a non-ops caller can neither read the queue nor decide a report")
    void buyerIsRefused() throws Exception {
        User buyer = user("9800000201", "buyer", "Buyer");
        User owner = user("9800000202", "owner", "Owner");
        Property listing = listing(owner);
        Report filed = report("property", listing.getId().toString(), buyer, "fake");

        mvc.perform(get("/reports").header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());

        mvc.perform(patch("/reports/{id}", filed.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(triage("actioned", "hide_content")))
                .andExpect(status().isForbidden());

        // The refusal has to be a refusal, not a 403 on the way out of a method that already ran.
        assertThat(properties.findById(listing.getId()).orElseThrow().getStatus())
                .isEqualTo(PropertyStatus.APPROVED);
    }

    // ------------------------------------------------------------------ the decision lands

    @Test
    @DisplayName("actioned + hide_content takes the listing off the public site, attributed to the moderator")
    void hideContentFlagsTheListing() throws Exception {
        User reporter = user("9800000203", "buyer", "Reporter");
        User owner = user("9800000204", "owner", "Owner");
        User staff = user("9800000205", "staff", "Ops");
        Property listing = listing(owner);
        Report filed = report("property", listing.getId().toString(), reporter, "fake");

        mvc.perform(patch("/reports/{id}", filed.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(triage("actioned", "hide_content")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("actioned"));

        Property after = properties.findById(listing.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(PropertyStatus.FLAGGED);
        // The reason is the half the owner and the next moderator actually read; a status change
        // with no reason is a listing that went dark for no recorded cause.
        assertThat(after.getFlagReason()).contains("Reported: fake");

        // Two audit rows, deliberately: one against the queue, one against the listing — an auditor
        // must see why a listing went dark without knowing a report existed.
        assertThat(jdbc.queryForObject(
                "select count(*) from audit_log where action = 'report.triage' and entity_id = ?",
                Integer.class, filed.getId().toString())).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "select actor from audit_log where action = 'property.flag' and entity_id = ?",
                String.class, listing.getId().toString()))
                .isEqualTo(staff.getId().toString());
    }

    @Test
    @DisplayName("actioned + suspend_account archives the reported account")
    void suspendAccountArchivesTheUser() throws Exception {
        User reporter = user("9800000206", "buyer", "Reporter");
        User offender = user("9800000207", "owner", "Offender");
        User admin = user("9800000208", "admin", "Admin");
        Report filed = report("user", offender.getId().toString(), reporter, "fraud");

        mvc.perform(patch("/reports/{id}", filed.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(triage("actioned", "suspend_account")))
                .andExpect(status().isOk());

        assertThat(users.findById(offender.getId()).orElseThrow().isArchived()).isTrue();
    }

    // ------------------------------------------------------------------ the refusals

    /**
     * "Dismissed, and also taken down" is not a decision anybody means, and permitting it would
     * leave an audit trail whose two halves contradict each other.
     */
    @Test
    @DisplayName("an enforcement is refused unless the report is being upheld")
    void enforcementRequiresActioned() throws Exception {
        User reporter = user("9800000209", "buyer", "Reporter");
        User owner = user("9800000210", "owner", "Owner");
        User staff = user("9800000211", "staff", "Ops");
        Property listing = listing(owner);
        Report filed = report("property", listing.getId().toString(), reporter, "fake");

        mvc.perform(patch("/reports/{id}", filed.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(triage("dismissed", "hide_content")))
                .andExpect(status().isBadRequest());

        assertThat(properties.findById(listing.getId()).orElseThrow().getStatus())
                .isEqualTo(PropertyStatus.APPROVED);
        assertThat(reports.findById(filed.getId()).orElseThrow().getStatus()).isEqualTo("open");
    }

    /**
     * A review can be taken down, but not from here — the refusal has to name the alternative, or the
     * moderator will believe fake reviews cannot be removed at all.
     */
    @Test
    @DisplayName("an unsupported target refuses by naming the endpoint that can do the job")
    void unsupportedTargetNamesTheAlternative() throws Exception {
        User reporter = user("9800000212", "buyer", "Reporter");
        User staff = user("9800000213", "staff", "Ops");
        Report filed = report("review", "11111111-1111-1111-1111-111111111111", reporter, "fake");

        mvc.perform(patch("/reports/{id}", filed.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(triage("actioned", "hide_content")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("/reviews/{id}/status")));
    }

    /** A request with no enforcement is the pre-existing caller; it must still decide and touch nothing. */
    @Test
    @DisplayName("triage without an enforcement field still decides and still changes nothing")
    void absentEnforcementIsNone() throws Exception {
        User reporter = user("9800000214", "buyer", "Reporter");
        User owner = user("9800000215", "owner", "Owner");
        User staff = user("9800000216", "staff", "Ops");
        Property listing = listing(owner);
        Report filed = report("property", listing.getId().toString(), reporter, "fake");

        mvc.perform(patch("/reports/{id}", filed.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"actioned\",\"note\":\"duplicate of an older one\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("actioned"));

        assertThat(properties.findById(listing.getId()).orElseThrow().getStatus())
                .isEqualTo(PropertyStatus.APPROVED);
    }

    // ------------------------------------------------------------------ filters

    /**
     * A client-side filter over one page stops being true the moment the queue outgrows the page,
     * and says nothing when it does.
     */
    @Test
    @DisplayName("the queue filters by reason and by target type, server-side")
    void queueFiltersServerSide() throws Exception {
        User reporter = user("9800000217", "buyer", "Reporter");
        User owner = user("9800000218", "owner", "Owner");
        User staff = user("9800000219", "staff", "Ops");
        Property listing = listing(owner);
        report("property", listing.getId().toString(), reporter, "fake");
        report("user", owner.getId().toString(), reporter, "fraud");

        mvc.perform(get("/reports").param("targetType", "user")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].targetType")
                        .value(org.hamcrest.Matchers.everyItem(
                                org.hamcrest.Matchers.equalTo("user"))));

        mvc.perform(get("/reports").param("reason", "fake")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].reason")
                        .value(org.hamcrest.Matchers.everyItem(
                                org.hamcrest.Matchers.equalTo("fake"))));

        // A mistyped filter must not read as "queue clear" — same appearance as a genuinely empty
        // queue.
        mvc.perform(get("/reports").param("reason", "notareason")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isBadRequest());
    }

    // ------------------------------------------------------------------ the dashboard tile

    /** The count comes from the queue's definition of outstanding, not a second copy of it. */
    @Test
    @DisplayName("the ops scorecard carries the reports backlog, counting claimed-but-undecided")
    void scorecardCarriesTheBacklog() throws Exception {
        User reporter = user("9800000220", "buyer", "Reporter");
        User owner = user("9800000221", "owner", "Owner");
        User staff = user("9800000222", "staff", "Ops");
        long before = jdbc.queryForObject(
                "select count(*) from reports where status in ('open','reviewing')", Long.class);

        Property listing = listing(owner);
        report("property", listing.getId().toString(), reporter, "fake");
        Report claimed = report("user", owner.getId().toString(), reporter, "fraud");
        claimed.triage("reviewing");
        reports.saveAndFlush(claimed);

        mvc.perform(get("/admin/dashboard").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openReports").value((int) (before + 2)));
    }
}
