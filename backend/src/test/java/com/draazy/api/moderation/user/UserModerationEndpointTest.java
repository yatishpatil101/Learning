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

/**
 * V77 — the four moderation actions {@code /admin/users} has always offered and the server has
 * never backed.
 *
 * <h2>What was actually wrong</h2>
 *
 * <p>The console shipped five row actions against a server that implemented two. Archive and restore
 * were real; suspend, the verified badge and the review flag were written into the browser's own
 * copy of the database, so they worked perfectly for one operator at one machine until they
 * reloaded. Converting the page onto the live API is what forced the question, and the answer taken
 * was to build the capability rather than record its loss.
 *
 * <h2>The assertion that matters most</h2>
 *
 * <p>{@link #aSuspendedAccountCannotSignIn()}. Writing {@code status = 'suspended'} is the easy half
 * and, on its own, the dangerous one: the column has existed since V2 and {@code AuthService} has
 * never read it, so a suspend button that only wrote it would have produced a badge. The moderator
 * would see the account marked as stopped, close the case, and the person would carry on signing in.
 * Every other test here is about a field; that one is about whether the feature exists.
 */
@DisplayName("V77 — suspend, badge and flag")
class UserModerationEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @PersistenceContext
    EntityManager em;

    /** See {@code StaffAccountApprovalTest} for why raw-SQL assertions need this. */
    private void flushSoRawSqlCanSeeIt() {
        em.flush();
    }

    /**
     * Audit rows are written {@code REQUIRES_NEW}, so they commit and outlive the class-level
     * rollback. Left behind they would accumulate across runs and, worse, be visible to the
     * entity-id filter test below, which counts.
     */
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

    private String path(String route, User target) {
        return route.replace("{id}", target.getId().toString());
    }

    // ---------------------------------------------------------------- suspension

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

        // flush before clear, not clear alone: the route ran inside this test's transaction, so the
        // status change is still only in the persistence context. Detaching without flushing throws
        // the write away and the assertion reports "active" — a failure that looks like the feature
        // not working.
        flushSoRawSqlCanSeeIt();
        em.clear();
        User reloaded = users.findById(target.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(UserStatuses.SUSPENDED);
        assertThat(reloaded.isArchived())
                .as("the whole point of suspension is that the account stays visible to the "
                        + "colleagues investigating it")
                .isFalse();
    }

    /**
     * The one that makes the button real. Sign in successfully, get suspended, and find the same
     * sign-in refused — the credential is unchanged, so nothing but the suspension can explain it.
     */
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

    /**
     * Reactivate deliberately refuses an archived account rather than quietly promoting it, because
     * the archived-to-active path has a guard this route does not (the live-email collision) and the
     * halfway state — {@code archived = true, status = 'active'} — is a row that is invisible to the
     * directory and claims to be fine.
     */
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

    // -------------------------------------------------------------------- badge

    @Test
    @DisplayName("an administrator can vouch for someone the DigiLocker funnel cannot reach")
    void badgeCanBeGrantedByHand() throws Exception {
        User actor = admin();
        User target = person("9877000006", Roles.Wire.OWNER);

        mvc.perform(patch(path(Routes.Users.BADGE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"granted\":true,\"reason\":\"documents checked in person\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(true))
                .andExpect(jsonPath("$.aadhaarVerified")
                        .value(false));

        flushSoRawSqlCanSeeIt();
        em.clear();
        assertThat(users.findById(target.getId()).orElseThrow().isAadhaarVerified())
                .as("a hand-granted badge stays distinguishable from an earned one, and that is "
                        + "what saves a column: verified && !aadhaarVerified is the whole signal")
                .isFalse();
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

    /**
     * The refusal is not deference to the funnel. It is that the withdrawal would be unrecoverable:
     * the verification handler returns early on an already-verified record, so nothing — not a
     * replay, not a re-run — would put the badge back.
     */
    @Test
    @DisplayName("an Aadhaar-earned badge cannot be withdrawn here")
    void aadhaarBadgeIsNotWithdrawable() throws Exception {
        User actor = admin();
        User target = person("9877000008", Roles.Wire.OWNER);
        jdbc.update("UPDATE users SET verified = true, aadhaar_verified = true WHERE id = ?",
                target.getId());
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

    // --------------------------------------------------------------------- flag

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

    /**
     * The flag is a note between moderators <em>about</em> the account holder, so the one route that
     * serves them their own profile must not carry it. Boxed on the record for exactly this: a
     * primitive would put {@code "flagged": false} here and invite a client to render it.
     */
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

    // ------------------------------------------------------------------ filters

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

    /**
     * An unknown status matches nothing, which is indistinguishable from a legitimately empty
     * filter — so a console with a typo in a dropdown would look like a working screen reporting an
     * empty platform, and the bug would be found by a user rather than by the request.
     */
    @Test
    @DisplayName("an unknown status is refused rather than answered with an empty page")
    void unknownStatusIsRefused() throws Exception {
        mvc.perform(get(Routes.Users.BASE).param("status", "banned")
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin())))
                .andExpect(status().isUnprocessableEntity());
    }

    /**
     * Without this filter the audit log is browsable only by time, which serves the daily review and
     * is useless for a case. It is also what lets the badge and flag routes get away with storing no
     * provenance of their own.
     */
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

    // ----------------------------------------------------------------- timeline

    /**
     * The account line is the one entry every user has, so it is the honest smoke test: a brand-new
     * account with no activity must still come back with exactly one event, not an empty list.
     */
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

    /**
     * The union is the whole point of the endpoint, so it has to be shown crossing at least one
     * module boundary. A moderation action is the cheapest second source to produce — it needs no
     * fixture beyond a route this class already exercises — and it also pins the audit join, which
     * is the one arm of the union keyed on a text column rather than a uuid.
     */
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
                // newest first, and the flag was raised after the account was made
                .andExpect(jsonPath("$[0].kind").value("moderation"))
                .andExpect(jsonPath("$[0].label").value("user.flag"))
                .andExpect(jsonPath("$[1].kind").value("account"));
    }

    /**
     * An empty timeline is a normal answer for a new account, so a mistyped id must not render as
     * "this person has done nothing" — see {@code UserModerationService#timeline}.
     */
    @Test
    @DisplayName("an unknown id is 404, not an empty timeline")
    void timelineRefusesAnUnknownId() throws Exception {
        mvc.perform(get(Routes.Users.TIMELINE.replace("{id}",
                        "00000000-0000-4000-8000-000000000000"))
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin())))
                .andExpect(status().isNotFound());
    }

    /**
     * Admin-only despite being a {@code users:read} route, because one arm of the union is the audit
     * log and {@code audit:read} is admin-only. Staff reaching this would get moderation history
     * they are refused at {@code GET /admin/audit-log} — the same data through an unlocked door.
     */
    @Test
    @DisplayName("staff cannot read a timeline either")
    void timelineIsAdminOnly() throws Exception {
        User staff = person("9877000022", Roles.Wire.STAFF);
        User target = person("9877000023", Roles.Wire.OWNER);

        mvc.perform(get(path(Routes.Users.TIMELINE, target))
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------------- guards

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
                            .content("{\"reason\":\"x\",\"granted\":true,\"flagged\":true}"))
                    .andExpect(status().isForbidden());
        }
    }

    // ------------------------------------------------------------------ helpers

    /**
     * Drive a real mobile-OTP sign-in and return the status of the verify step. Lifted from
     * {@code StaffAccountApprovalTest}: the dispatched code is only ever logged, so the stored hash
     * is replaced with the hash of a code this test chooses, which is narrower than parsing the mock
     * sender's log line.
     */
    private int otpLogin(String mobile) throws Exception {
        // The send cooldown is keyed on the newest otp_codes row for this number, so a test that
        // signs the same person in twice — which is exactly what "worked before, refused after"
        // requires — would get 429 on the second send. Clearing the rows resets the throttle and
        // nothing else about the flow under test.
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
        // Detach, or the rewrite above is invisible to the code under test — see the note on the
        // same helper in StaffAccountApprovalTest.
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
}
