package com.draazy.api.moderation.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.user.UserStatuses;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// Suspend, verified badge and review-flag actions. Load-bearing: aSuspendedAccountCannotSignIn —
// writing status='suspended' without AuthService reading it would only produce a badge.
@DisplayName("V77 — suspend, badge and flag")
class UserModerationEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @PersistenceContext
    EntityManager em;

    /** The service and this test share one transaction, but raw SQL cannot see unflushed entities. */
    private void flushSoRawSqlCanSeeIt() {
        em.flush();
    }

    // Audit rows are REQUIRES_NEW so they outlive class rollback; leaving them would poison the
    // entity-id filter test below, which counts.
    @AfterEach
    void clearCommittedAuditRows() {
        jdbc.update("DELETE FROM audit_log WHERE action LIKE 'user.%'");
    }

    private User person(String mobile, String role) {
        User user = new User(mobile, role);
        user.setName("V77 probe " + mobile);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private User admin() {
        return person("9877000001", Roles.Wire.ADMIN);
    }

    private User admin(String mobile) {
        return person(mobile, Roles.Wire.ADMIN);
    }

    private String path(String route, User target) {
        return route.replace("{id}", target.getId().toString());
    }

    @Test
    @DisplayName("suspend marks the account without removing it from the directory")
    void suspendIsNotArchive() throws Exception {
        User actor = admin();
        User target = person("9877000002", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.SUSPEND, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"listings look fake\"}"))
                .andExpect(status().isOk());

        // Flush before clear: the route ran inside this test's transaction, so detaching without
        // flushing throws the status write away and reports "active".
        flushSoRawSqlCanSeeIt();
        em.clear();
        User reloaded = users.findById(target.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(UserStatuses.SUSPENDED);
        assertThat(reloaded.isArchived())
                .as("the whole point of suspension is that the account stays visible to the "
                        + "colleagues investigating it")
                .isFalse();
    }

    @Test
    @DisplayName("a suspended account cannot sign in")
    void aSuspendedAccountCannotSignIn() throws Exception {
        User actor = admin();
        User target = person("9877000003", Roles.Wire.BUYER);

        assertThat(otpLogin(target.getMobile()))
                .as("positive control: the account signs in perfectly well before the suspension")
                .isEqualTo(200);

        mvc.perform(patch(path(Routes.Users.SUSPEND, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"under review\"}"))
                .andExpect(status().isOk());

        assertThat(otpLogin(target.getMobile()))
                .as("403 after the OTP is verified, so the refusal tells them nothing they did "
                        + "not already know")
                .isEqualTo(403);
    }

    @Test
    @DisplayName("reactivating lets them back in")
    void reactivateRestoresTheSession() throws Exception {
        User actor = admin();
        User target = person("9877000004", Roles.Wire.BUYER);

        mvc.perform(patch(path(Routes.Users.SUSPEND, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"under review\"}"))
                .andExpect(status().isOk());
        assertThat(otpLogin(target.getMobile())).isEqualTo(403);

        mvc.perform(patch(path(Routes.Users.REACTIVATE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk());

        assertThat(otpLogin(target.getMobile()))
                .as("the suspension is reversible, which is what distinguishes it from erasure")
                .isEqualTo(200);
    }

    @Test
    @DisplayName("manager suspension actions notify the administrator")
    void managerSuspensionActionsNotifyAdministrator() throws Exception {
        User owner = admin("9877000050");
        User actor = person("9877000051", Roles.Wire.MANAGER);
        User target = person("9877000052", Roles.Wire.STAFF);

        mvc.perform(patch(path(Routes.Users.SUSPEND, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"manager check\"}"))
                .andExpect(status().isOk());
        mvc.perform(patch(path(Routes.Users.REACTIVATE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk());

        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM notifications
                WHERE user_id = ?::uuid AND type = 'team.manager-action'
                """, Integer.class, owner.getId())).isEqualTo(2);
    }

    @Test
    @DisplayName("you cannot suspend yourself")
    void selfSuspensionIsRefused() throws Exception {
        User actor = admin();

        mvc.perform(patch(path(Routes.Users.SUSPEND, actor))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"oops\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message").value("You cannot suspend your own account"));
    }

    // Reactivate refuses an archived account (rather than silently promoting) because the
    // archived-to-active path has a live-email collision guard this route does not.
    @Test
    @DisplayName("reactivate refuses an archived account and points at restore")
    void reactivateIsNotRestore() throws Exception {
        User actor = admin();
        User target = person("9877000005", Roles.Wire.BUYER);
        jdbc.update("UPDATE users SET status = 'archived' WHERE id = ?", target.getId());
        em.clear();

        mvc.perform(patch(path(Routes.Users.REACTIVATE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message")
                        .value("This account is archived, not suspended. Restore it first."));
    }

    @Test
    @DisplayName("a badge grant creates a pending request, not a badge")
    void badgeGrantCreatesPendingRequest() throws Exception {
        User actor = admin("9877000001");
        User target = person("9877000006", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":true,\"reason\":\"documents checked in person\"}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.userId").value(target.getId().toString()))
                .andExpect(jsonPath("$.requestedBy").value(actor.getId().toString()))
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.userMobileMasked").value("98XXXXX006"));

        flushSoRawSqlCanSeeIt();
        em.clear();
        assertThat(users.findById(target.getId()).orElseThrow().isVerified()).isFalse();
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM badge_grant_requests
                WHERE user_id = ? AND requested_by = ? AND status = 'pending'
                """, Integer.class, target.getId(), actor.getId())).isEqualTo(1);
    }

    @Test
    @DisplayName("a user cannot request their own manual badge")
    void badgeGrantSelfRequestIsRefused() throws Exception {
        User actor = admin("9877000024");

        mvc.perform(patch(path(Routes.Users.BADGE, actor))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":true,\"reason\":\"documents checked in person\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a duplicate pending badge grant is refused")
    void duplicateBadgeGrantIsRefused() throws Exception {
        User actor = admin("9877000025");
        User target = person("9877000026", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":true,\"reason\":\"documents checked in person\"}"))
                .andExpect(status().isAccepted());

        mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":true,\"reason\":\"fresh documents checked\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("a manual badge grant is refused when the user is already verified")
    void badgeGrantAlreadyVerifiedIsRefused() throws Exception {
        User actor = admin("9877000027");
        User target = person("9877000028", Roles.Wire.OWNER);
        target.setVerified(true);
        users.saveAndFlush(target);

        mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":true,\"reason\":\"documents checked in person\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("a padded badge grant reason is measured after trimming")
    void badgeGrantReasonIsTrimValidated() throws Exception {
        User actor = admin("9877000044");
        User target = person("9877000045", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":true,\"reason\":\"          x          \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message")
                        .value("reason must be 10 to 300 characters after trimming"));
    }

    @Test
    @DisplayName("a second administrator can approve a badge request")
    void badgeGrantApprovalGrantsBadgeAndAudits() throws Exception {
        User maker = admin("9877000029");
        User checker = admin("9877000030");
        User target = person("9877000031", Roles.Wire.OWNER);

        String created = mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(maker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":true,\"reason\":\"documents checked in person\"}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        String requestId = jsonField(created, "id");

        mvc.perform(post(Routes.Admin.BADGE_GRANT_APPROVE.replace("{id}", requestId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"looks good\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.decidedBy").value(checker.getId().toString()))
                .andExpect(jsonPath("$.decisionNote").value("looks good"));

        flushSoRawSqlCanSeeIt();
        em.clear();
        assertThat(users.findById(target.getId()).orElseThrow().isVerified()).isTrue();
        assertThat(jdbc.queryForObject("SELECT status FROM badge_grant_requests WHERE id = ?::uuid",
                String.class, requestId)).isEqualTo("approved");
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM audit_log
                WHERE action = 'user.badge.grant_approved' AND entity_id = ?
                """, Integer.class, requestId)).isEqualTo(1);
    }

    @Test
    @DisplayName("the maker cannot approve their own badge request")
    void badgeGrantMakerCannotApprove() throws Exception {
        User maker = admin("9877000032");
        User target = person("9877000033", Roles.Wire.OWNER);
        String requestId = createBadgeGrant(maker, target);

        mvc.perform(post(Routes.Admin.BADGE_GRANT_APPROVE.replace("{id}", requestId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(maker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("the subject cannot approve their own badge request")
    void badgeGrantSubjectCannotApprove() throws Exception {
        User maker = admin("9877000034");
        User target = admin("9877000035");
        String requestId = createBadgeGrant(maker, target);

        mvc.perform(post(Routes.Admin.BADGE_GRANT_APPROVE.replace("{id}", requestId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(target))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("rejecting a badge request requires a reason and leaves the user unverified")
    void badgeGrantRejectRequiresReason() throws Exception {
        User maker = admin("9877000036");
        User checker = admin("9877000037");
        User target = person("9877000038", Roles.Wire.OWNER);
        String requestId = createBadgeGrant(maker, target);

        mvc.perform(post(Routes.Admin.BADGE_GRANT_REJECT.replace("{id}", requestId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"\"}"))
                .andExpect(status().isUnprocessableEntity());

        mvc.perform(post(Routes.Admin.BADGE_GRANT_REJECT.replace("{id}", requestId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"document mismatch\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("rejected"))
                .andExpect(jsonPath("$.decisionNote").value("document mismatch"));

        flushSoRawSqlCanSeeIt();
        em.clear();
        assertThat(users.findById(target.getId()).orElseThrow().isVerified()).isFalse();
    }

    @Test
    @DisplayName("a padded badge grant rejection reason is measured after trimming")
    void badgeGrantRejectReasonIsTrimValidated() throws Exception {
        User maker = admin("9877000046");
        User checker = admin("9877000047");
        User target = person("9877000048", Roles.Wire.OWNER);
        String requestId = createBadgeGrant(maker, target);

        mvc.perform(post(Routes.Admin.BADGE_GRANT_REJECT.replace("{id}", requestId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"          x          \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message")
                        .value("reason must be 10 to 300 characters after trimming"));
    }

    @Test
    @DisplayName("a decided badge request cannot be decided again")
    void badgeGrantNonPendingIsAConflict() throws Exception {
        User maker = admin("9877000039");
        User checker = admin("9877000040");
        User target = person("9877000041", Roles.Wire.OWNER);
        String requestId = createBadgeGrant(maker, target);

        mvc.perform(post(Routes.Admin.BADGE_GRANT_REJECT.replace("{id}", requestId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"document mismatch\"}"))
                .andExpect(status().isOk());

        mvc.perform(post(Routes.Admin.BADGE_GRANT_APPROVE.replace("{id}", requestId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("a pending badge grant must be rejected before withdrawal")
    void badgeWithdrawalWithPendingRequestIsRefused() throws Exception {
        User actor = admin("9877000042");
        User target = person("9877000043", Roles.Wire.OWNER);
        createBadgeGrant(actor, target);

        mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":false,\"reason\":\"documents stale now\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(
                        "This user has a pending badge grant request. Reject the pending request instead."));
    }

    @Test
    @DisplayName("a hand-granted badge can be taken back")
    void badgeCanBeWithdrawn() throws Exception {
        User actor = admin();
        User target = person("9877000007", Roles.Wire.OWNER);
        jdbc.update("UPDATE users SET verified = true WHERE id = ?", target.getId());
        em.clear();

        mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":false,\"reason\":\"documents turned out to be stale\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(false));
    }

    @Test
    @DisplayName("a badge earned through identity verification cannot be withdrawn here")
    void earnedBadgeIsNotWithdrawable() throws Exception {
        User actor = admin();
        User target = person("9877000008", Roles.Wire.OWNER);
        jdbc.update("UPDATE users SET verified = true WHERE id = ?", target.getId());
        jdbc.update("""
                insert into identity_verifications
                       (user_id, status, doc_type, doc_last4, holder_name, holder_dob, identity_hash,
                        consent_at, submitted_at, attempt_count, attempt_window_start, decided_at)
                values (?, 'verified', 'pan', 'D123', 'Earned Badge', date '1985-03-03', ?,
                        now(), now(), 1, now(), now())
                """, target.getId(), "hmac-" + target.getId());
        em.clear();

        mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":false,\"reason\":\"second thoughts\"}"))
                .andExpect(status().isConflict());

        em.clear();
        assertThat(users.findById(target.getId()).orElseThrow().isVerified())
                .as("the refusal changed nothing")
                .isTrue();
    }

    @Test
    @DisplayName("omitting granted is refused, not read as a silent withdrawal")
    void badgeGrantedIsRequired() throws Exception {
        User actor = admin();
        User target = person("9877000009", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"nothing in particular\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("a flag carries what was noticed, and clearing it forgets")
    void flagRoundTrip() throws Exception {
        User actor = admin();
        User target = person("9877000010", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.FLAG, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flagged\":true,\"reason\":\"three listings at one address\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flagged").value(true))
                .andExpect(jsonPath("$.flagReason").value("three listings at one address"));

        mvc.perform(patch(path(Routes.Users.FLAG, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flagged\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flagged").value(false))
                .andExpect(jsonPath("$.flagReason")
                        .doesNotExist());
    }

    @Test
    @DisplayName("a flag without a reason is refused")
    void flaggingNeedsAReason() throws Exception {
        User actor = admin();
        User target = person("9877000011", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.FLAG, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flagged\":true}"))
                .andExpect(status().isUnprocessableEntity());

        em.clear();
        assertThat(users.findById(target.getId()).orElseThrow().isFlagged()).isFalse();
    }

    // The flag is a note between moderators about the holder, so the /me route must not carry it;
    // boxed on the record so an omitted value does not render as false.
    @Test
    @DisplayName("the review flag never appears on the account holder's own profile")
    void ownProfileDoesNotCarryTheFlag() throws Exception {
        User actor = admin();
        User target = person("9877000012", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.FLAG, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flagged\":true,\"reason\":\"under review\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Auth.ME)
                        .header(HttpHeaders.AUTHORIZATION, bearer(target)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flagged").doesNotExist())
                .andExpect(jsonPath("$.flagReason").doesNotExist());
    }

    @Test
    @DisplayName("the directory can be filtered by status and by flag")
    void directoryFilters() throws Exception {
        User actor = admin();
        User suspended = person("9877000013", Roles.Wire.OWNER);
        User flagged = person("9877000014", Roles.Wire.OWNER);
        person("9877000015", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.SUSPEND, suspended))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"under review\"}"))
                .andExpect(status().isOk());
        mvc.perform(patch(path(Routes.Users.FLAG, flagged))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flagged\":true,\"reason\":\"duplicate listings\"}"))
                .andExpect(status().isOk());
        flushSoRawSqlCanSeeIt();

        mvc.perform(get(Routes.Users.BASE).param("status", UserStatuses.SUSPENDED)
                        .param("q", "9877000")
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].id").value(suspended.getId().toString()));

        mvc.perform(get(Routes.Users.BASE).param("flagged", "true")
                        .param("q", "9877000")
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].id").value(flagged.getId().toString()));
    }

    @Test
    @DisplayName("counts=true tallies the whole filtered set, whatever tab or page was asked for")
    void countsCoverTheWholeSet() throws Exception {
        User actor = admin("9877100001");
        User suspended = person("9877100002", Roles.Wire.OWNER);
        User archived = person("9877100003", Roles.Wire.BUYER);
        person("9877100004", Roles.Wire.BUYER);
        mvc.perform(patch(path(Routes.Users.SUSPEND, suspended))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"under review\"}"))
                .andExpect(status().isOk());
        flushSoRawSqlCanSeeIt();
        jdbc.update("update users set archived = true where id = ?", archived.getId());

        mvc.perform(get(Routes.Users.BASE).param("counts", "true").param("q", "98771000")
                        .param("customers", "true").param("size", "1")
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.counts.all").value(2))
                .andExpect(jsonPath("$.counts.active").value(1))
                .andExpect(jsonPath("$.counts.suspended").value(1))
                .andExpect(jsonPath("$.counts.archived").value(1));

        mvc.perform(get(Routes.Users.BASE).param("q", "98771000")
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.counts").doesNotExist());
    }

    @Test
    @DisplayName("an unknown status is refused rather than answered with an empty page")
    void unknownStatusIsRefused() throws Exception {
        mvc.perform(get(Routes.Users.BASE).param("status", "banned")
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin())))
                .andExpect(status().isUnprocessableEntity());
    }

    // Without this filter the audit log is browsable only by time, useless for a case — and it is
    // what lets the badge and flag routes store no provenance of their own.
    @Test
    @DisplayName("admin edit cannot change a verified user's name")
    void adminNameChangeIsLockedForVerifiedUsers() throws Exception {
        User actor = admin("9877000049");
        User target = person("9877000050", Roles.Wire.OWNER);
        target.setVerified(true);
        users.saveAndFlush(target);

        mvc.perform(patch(path(Routes.Users.BY_ID, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Renamed Owner\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("NAME_LOCKED_WHILE_VERIFIED"));

        em.clear();
        assertThat(users.findById(target.getId()).orElseThrow().getName())
                .isEqualTo("V77 probe 9877000050");
    }

    @Test
    @DisplayName("admin name changes audit the previous value")
    void adminNameChangeAuditsPreviousName() throws Exception {
        User actor = admin("9877000051");
        User target = person("9877000052", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.BY_ID, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Renamed Owner\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Renamed Owner"));

        String metadata = jdbc.queryForObject("""
                SELECT metadata::text FROM audit_log
                WHERE action = 'user.update' AND entity_id = ?
                ORDER BY at DESC LIMIT 1
                """, String.class, target.getId().toString());
        assertThat(metadata).contains("\"previousName\": \"V77 probe 9877000052\"");
    }

    @Test
    @DisplayName("the audit log can answer what has happened to one person")
    void auditLogFiltersByEntityId() throws Exception {
        User actor = admin();
        User target = person("9877000016", Roles.Wire.OWNER);
        User other = person("9877000017", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.FLAG, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flagged\":true,\"reason\":\"duplicate listings\"}"))
                .andExpect(status().isOk());
        mvc.perform(patch(path(Routes.Users.FLAG, other))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flagged\":true,\"reason\":\"unrelated\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Admin.AUDIT_LOG)
                        .param("entity", "user")
                        .param("entityId", target.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].action").value("user.flag"))
                .andExpect(jsonPath("$.content[0].entityId").value(target.getId().toString()));
    }

    // The account line is the one entry every user has, so a brand-new account must still come
    // back with exactly one event rather than an empty list.
    @Test
    @DisplayName("a new account's timeline is its creation and nothing else")
    void timelineAlwaysHasTheAccountLine() throws Exception {
        User actor = admin();
        User target = person("9877000020", Roles.Wire.BUYER);

        mvc.perform(get(path(Routes.Users.TIMELINE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].kind").value("account"))
                .andExpect(jsonPath("$[0].label").value(Roles.Wire.BUYER))
                .andExpect(jsonPath("$[0].entityId").value(target.getId().toString()));
    }

    // Cross at least one module boundary; a moderation action is the cheapest second source and
    // pins the audit join — the one arm of the union keyed on text rather than uuid.
    @Test
    @DisplayName("the timeline unions moderation actions with the account line")
    void timelineIncludesModerationActions() throws Exception {
        User actor = admin();
        User target = person("9877000021", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.FLAG, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flagged\":true,\"reason\":\"duplicate listings\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(path(Routes.Users.TIMELINE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))

                .andExpect(jsonPath("$[0].kind").value("moderation"))
                .andExpect(jsonPath("$[0].label").value("user.flag"))
                .andExpect(jsonPath("$[1].kind").value("account"));
    }

    // An empty timeline is a normal answer for a new account, so a mistyped id must not render as
    // "this person has done nothing" — see UserModerationService#timeline.
    @Test
    @DisplayName("an unknown id is 404, not an empty timeline")
    void timelineRefusesAnUnknownId() throws Exception {
        mvc.perform(get(Routes.Users.TIMELINE.replace("{id}",
                        "00000000-0000-4000-8000-000000000000"))
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin())))
                .andExpect(status().isNotFound());
    }

    // Admin-only despite users:read, because one arm of the union is the audit log (admin-only) —
    // staff reaching this would get moderation history through an unlocked door.
    @Test
    @DisplayName("staff cannot read a timeline either")
    void timelineIsAdminOnly() throws Exception {
        User staff = person("9877000022", Roles.Wire.STAFF);
        User target = person("9877000023", Roles.Wire.OWNER);

        mvc.perform(get(path(Routes.Users.TIMELINE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isForbidden());
    }

    // guards
    @Test
    @DisplayName("staff cannot reach any of the four")
    void staffAreRefused() throws Exception {
        User staff = person("9877000018", Roles.Wire.STAFF);
        User target = person("9877000019", Roles.Wire.OWNER);

        for (String route : new String[] {Routes.Users.SUSPEND, Routes.Users.REACTIVATE,
                Routes.Users.BADGE, Routes.Users.FLAG}) {
            mvc.perform(patch(path(route, target))
                            .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"reason\":\"staff must not act\",\"granted\":true,\"flagged\":true}"))
                    .andExpect(status().isForbidden());
        }
    }

    private int otpLogin(String mobile) throws Exception {

        flushSoRawSqlCanSeeIt();
        jdbc.update("DELETE FROM otp_codes WHERE mobile = ?", mobile);
        em.clear();
        mvc.perform(post(Routes.Auth.LOGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"%s\"}".formatted(mobile)))
                .andExpect(status().isOk());
        flushSoRawSqlCanSeeIt();
        jdbc.update("""
                UPDATE otp_codes SET code_hash = ?
                WHERE id = (SELECT id FROM otp_codes WHERE mobile = ?
                            ORDER BY created_at DESC LIMIT 1)""",
                sha256Hex("424242"), mobile);

        em.clear();
        return mvc.perform(post(Routes.Auth.LOGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"%s\",\"otp\":\"424242\"}".formatted(mobile)))
                .andReturn().getResponse().getStatus();
    }

    private static String sha256Hex(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte b : digest) {
            hex.append("%02x".formatted(b));
        }
        return hex.toString();
    }

    private String createBadgeGrant(User maker, User target) throws Exception {
        String body = mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(maker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":true,\"reason\":\"documents checked in person\"}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        return jsonField(body, "id");
    }

    private static String jsonField(String json, String field) {
        return json.replaceAll("(?s).*\"" + field + "\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }
}
