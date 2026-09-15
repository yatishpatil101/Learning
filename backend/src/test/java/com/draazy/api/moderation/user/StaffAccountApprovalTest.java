package com.draazy.api.moderation.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.access.BackOfficeGrant;
import com.draazy.api.common.access.BackOfficeGrantRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.auth.RefreshCookie;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;

/** An account minted through {@code POST /users/staff} cannot authenticate until a second
 *  administrator approves it. Invariants: {@code docs/flows/admin/settings-team-staff.md} §6. */
@DisplayName("D200 — maker-checker on back-office account creation")
class StaffAccountApprovalTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    BackOfficeGrantRepository grants;

    /* Asked for rather than hardcoded: the cookie name is `__Host-` prefixed wherever it is Secure. */
    @Autowired
    RefreshCookie cookies;

    @PersistenceContext
    EntityManager em;

    /** The service and this test share one transaction but not one layer: {@code save} only stages
     *  the row in the persistence context, so raw SQL on the same connection would find nothing. */
    private void flushSoRawSqlCanSeeIt() {
        em.flush();
    }

    /** The bootstrap escape counts every admin-role row on the platform, so "no other administrator"
     *  has to be said explicitly. Demoting rather than deleting keeps every foreign key intact. */
    private void leaveNoOtherAdministrators() {
        jdbc.update("UPDATE users SET role = 'buyer' WHERE role = 'admin'");
    }

    private User admin(String mobile, String email) {
        User user = new User(mobile, Roles.Wire.ADMIN);
        user.setName("Approval probe " + mobile);
        user.setEmail(email);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    /** Team is supplied for {@code staff} and withheld for {@code admin} because {@code addStaff}
     *  requires exactly that; no case here is testing the field, so the helper keeps the body valid. */
    private String createStaffAs(User actor, String mobile, String email, String role)
            throws Exception {
        String team = Roles.Wire.STAFF.equals(role) ? ",\"team\":\"" + Teams.RENTAL + "\"" : "";
        return mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Minted","mobile":"%s","email":"%s","role":"%s"%s}"""
                                .formatted(mobile, email, role, team)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    /** Every password-login assertion here depends on this: an un-activated account answers 401 for
     *  a reason unrelated to maker-checker, so activating first keeps a 403 meaning "held". */
    private void activate(String userId, String password) throws Exception {
        flushSoRawSqlCanSeeIt();
        String inviteId = jdbc.queryForObject(
                "SELECT id::text FROM staff_invites WHERE user_id = ?::uuid", String.class, userId);
        jdbc.update("UPDATE staff_invites SET token_hash = ? WHERE id = ?::uuid",
                sha256Hex("chosen-by-the-test"), inviteId);
        // Detach, or the rewrite above is invisible to the code under test — see otpLogin.
        em.clear();
        mvc.perform(post(Routes.Auth.STAFF_INVITE_REDEEM)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"%s.chosen-by-the-test\",\"password\":\"%s\"}"
                                .formatted(inviteId, password)))
                .andExpect(status().isNoContent());
    }

    private int staffLogin(String email, String password) throws Exception {
        return mvc.perform(post(Routes.Auth.STAFF_LOGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"%s\",\"password\":\"%s\"}"
                                .formatted(email, password)))
                .andReturn().getResponse().getStatus();
    }

    /** The dispatched code is only ever logged, so the stored hash is replaced with one this test
     *  chooses; the alternative — parsing the mock sender's log line — couples us to a log format. */
    private int otpLogin(String mobile) throws Exception {
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
        // Detach, or the rewrite above is invisible: Hibernate resolves the JPQL row to the OtpCode
        // instance it already holds and discards the freshly-read code_hash column.
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

    /** The {@code id} of a just-created account, out of the 201 body. */
    private static String idOf(String createdJson) {
        return createdJson.replaceAll("(?s).*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    /** Returns the {@code Cookie} rather than its value so callers hand it straight back: a test
     *  that unwrapped and rewrapped it would keep passing if the server stopped setting it. */
    private Cookie refreshCookieOf(MockHttpServletResponse response) {
        Cookie cookie = response.getCookie(cookies.name());
        assertThat(cookie).as("auth response should carry a refresh cookie").isNotNull();
        return cookie;
    }

    @AfterEach
    void clearCommittedAuditRows() {
        jdbc.update("DELETE FROM audit_log WHERE action LIKE 'user.staff.%'");
    }

    /** The premise is realistic: an ops lead scoped out of finance still needs {@code users:write},
     *  and every call in the escalation below is individually authorised. */
    @Test
    @DisplayName("a narrowed admin cannot mint itself a way back in")
    void aNarrowedAdminCannotMintItselfAWayBackIn() throws Exception {
        User founder = admin("9866040001", "founder@example.com");
        User narrowed = admin("9866040002", "narrowed@example.com");
        grants.saveAndFlush(new BackOfficeGrant(narrowed.getId(),
                "[\"users:read\",\"users:write\"]", founder.getId()));

        // The narrowing is real: the account has lost the dashboard it was scoped out of...
        assertThat(mvc.perform(get(Routes.Admin.DASHBOARD)
                        .header(HttpHeaders.AUTHORIZATION, bearer(narrowed)))
                .andReturn().getResponse().getStatus()).isEqualTo(403);

        // ...but it can still mint a colleague, which is the surface under test.
        String created = createStaffAs(narrowed, "9866040003", "minted@example.com",
                Roles.Wire.ADMIN);
        String mintedId = idOf(created);
        // Activated by its holder, so the only thing left between it and a session is the approval;
        // otherwise the 403s below would be the unredeemed-invite gate.
        activate(mintedId, "Str0ng-passphrase!");

        // The escalation stops here: the minted administrator cannot obtain a token at all.
        assertThat(staffLogin("minted@example.com", "Str0ng-passphrase!")).isEqualTo(403);

        // Nor can its creator wave it through — that is the entire content of maker-checker.
        assertThat(mvc.perform(post(Routes.Users.APPROVE.replace("{id}", mintedId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(narrowed)))
                .andReturn().getResponse().getStatus()).isEqualTo(403);
        assertThat(staffLogin("minted@example.com", "Str0ng-passphrase!")).isEqualTo(403);

        // A different administrator can, and only then does the account come to life.
        mvc.perform(post(Routes.Users.APPROVE.replace("{id}", mintedId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(founder)))
                .andExpect(status().isOk());
        assertThat(staffLogin("minted@example.com", "Str0ng-passphrase!")).isEqualTo(200);
    }

    /** The only case that reaches the gate on {@code /auth/refresh}: every other account here is
     *  held at creation, so it never has a token to refresh. Sign-in must precede the hold. */
    @Test
    @DisplayName("a hold placed on an existing account kills its refresh token too")
    void aHeldAccountCannotRefreshAnExistingSession() throws Exception {
        User founder = admin("9866040070", "founder8@example.com");
        User checker = admin("9866040071", "checker8@example.com");
        String created = createStaffAs(founder, "9866040072", "serving@example.com",
                Roles.Wire.STAFF);
        String servingId = idOf(created);
        activate(servingId, "Str0ng-passphrase!");

        // Approved, so the account is fully live and holds a real session — the premise of the test.
        mvc.perform(post(Routes.Users.APPROVE.replace("{id}", servingId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker)))
                .andExpect(status().isOk());

        Cookie session = refreshCookieOf(mvc.perform(post(Routes.Auth.STAFF_LOGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"serving@example.com\","
                                + "\"password\":\"Str0ng-passphrase!\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse());

        // The rotated cookie has to be carried forward: the one just spent is revoked, so presenting
        // it again would answer 401 for reuse whether or not the gate below exists.
        Cookie rotated = refreshCookieOf(mvc.perform(post(Routes.Auth.REFRESH).cookie(session))
                .andExpect(status().isOk())
                .andReturn().getResponse());

        // The hold, placed by hand on a live account: no route does this yet, which is why the gate
        // it depends on needs a test of its own now rather than later.
        jdbc.update("UPDATE staff_account_approvals SET approved_by = NULL, approved_at = NULL"
                + " WHERE user_id = ?::uuid", servingId);

        assertThat(mvc.perform(post(Routes.Auth.REFRESH).cookie(rotated))
                .andReturn().getResponse().getStatus()).isEqualTo(403);
    }

    /** A held account leaves no other trace: it looks identical to nobody having got round to it,
     *  so the refusal row is the only thing distinguishing that from the move the rule stops. */
    @Test
    @DisplayName("a maker's attempt to approve their own hire is written to the audit log")
    void theSelfApprovalRefusalIsAudited() throws Exception {
        User founder = admin("9866040065", "founder6@example.com");
        // A second administrator has to exist or the bootstrap escape fires and the hire is never
        // held, so approving it answers 409 rather than reaching the refusal under test.
        admin("9866040073", "peer8@example.com");
        String created = createStaffAs(founder, "9866040066", "self-approve@example.com",
                Roles.Wire.STAFF);
        String hireId = idOf(created);

        assertThat(mvc.perform(post(Routes.Users.APPROVE.replace("{id}", hireId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(founder)))
                .andReturn().getResponse().getStatus()).isEqualTo(403);

        // Scoped to this account rather than counted globally: the @AfterEach cleanup rolls back
        // with the test transaction, so refusals written by sibling tests are still in the table.
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM audit_log"
                        + " WHERE action = 'user.staff.approve.refused' AND entity_id = ?",
                Integer.class, hireId)).isEqualTo(1);
    }

    /** Role is re-resolved per request, but archiving does not invalidate an access token already
     *  issued — and approving a colleague is the gesture that should not survive the door. */
    @Test
    @DisplayName("an archived administrator cannot approve, even holding a live token")
    void anArchivedAdministratorCannotApprove() throws Exception {
        User founder = admin("9866040067", "founder9@example.com");
        User leaver = admin("9866040068", "leaver@example.com");
        String created = createStaffAs(founder, "9866040069", "held-hire@example.com",
                Roles.Wire.STAFF);
        activate(idOf(created), "Str0ng-passphrase!");

        // The token is minted while the account is still live, then the account is archived —
        // which is the whole point: the credential outlives the authority.
        String token = bearer(leaver);
        leaver.archive("left the desk");
        users.saveAndFlush(leaver);

        assertThat(mvc.perform(post(Routes.Users.APPROVE.replace("{id}", idOf(created)))
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andReturn().getResponse().getStatus()).isEqualTo(403);
        assertThat(staffLogin("held-hire@example.com", "Str0ng-passphrase!")).isEqualTo(403);
    }

    /** Why the gate sits in {@code issueFor} and not {@code staffLogin}: a minted account has a
     *  mobile number, so a password-path gate refuses only the door nobody was going to use. */
    @Test
    @DisplayName("the held account cannot sign in by OTP either")
    void theHeldAccountCannotSignInByOtp() throws Exception {
        User founder = admin("9866040004", "founder2@example.com");
        admin("9866040005", "peer2@example.com");
        String mobile = "9866040006";
        String created = createStaffAs(founder, mobile, "minted2@example.com", Roles.Wire.STAFF);
        // Activated, so the refusal below can only be the approval gate: an un-activated account is
        // refused too, which would make this pass without the gate existing at all.
        activate(idOf(created), "Str0ng-passphrase!");

        assertThat(otpLogin(mobile)).isEqualTo(403);
    }

    /** Positive control for the test above. Separate rather than a second half of it because
     *  {@code OtpService}'s per-mobile send cooldown would answer the second send 429. */
    @Test
    @DisplayName("an approved account signs in by OTP normally")
    void anApprovedAccountSignsInByOtp() throws Exception {
        User founder = admin("9866040024", "founder7@example.com");
        User peer = admin("9866040025", "peer7@example.com");
        String mobile = "9866040026";
        String created = createStaffAs(founder, mobile, "approved@example.com",
                Roles.Wire.STAFF);
        activate(idOf(created), "Str0ng-passphrase!");
        mvc.perform(post(Routes.Users.APPROVE.replace("{id}", idOf(created)))
                        .header(HttpHeaders.AUTHORIZATION, bearer(peer)))
                .andExpect(status().isOk());

        assertThat(otpLogin(mobile)).isEqualTo(200);
    }

    /** A rule nobody can satisfy is a lockout, not a control: the first administrator on a fresh
     *  install has no peer to co-sign with. */
    @Test
    @DisplayName("the only administrator on the platform is not held by a rule nobody can satisfy")
    void theSoleAdministratorIsNotHeld() throws Exception {
        leaveNoOtherAdministrators();
        User founder = admin("9866040007", "solo@example.com");

        String created = createStaffAs(founder, "9866040008", "first-hire@example.com",
                Roles.Wire.STAFF);
        activate(idOf(created), "Str0ng-passphrase!");

        // Flushed even though this one expects zero: unflushed it would report zero whether or not
        // the escape worked.
        flushSoRawSqlCanSeeIt();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_account_approvals",
                Integer.class)).isZero();
        assertThat(staffLogin("first-hire@example.com", "Str0ng-passphrase!")).isEqualTo(200);
    }

    /** Not redundant with its staff-role twin: {@code approvalIsPossible} filters on {@code role},
     *  and only an admin-role hire can self-count and strand a lone founder permanently. */
    @Test
    @DisplayName("the sole administrator's first admin colleague is not held either")
    void theSoleAdministratorsFirstAdminColleagueIsNotHeld() throws Exception {
        leaveNoOtherAdministrators();
        User founder = admin("9866040060", "solo-admin@example.com");

        String created = createStaffAs(founder, "9866040061", "co-admin@example.com",
                Roles.Wire.ADMIN);
        activate(idOf(created), "Str0ng-passphrase!");

        flushSoRawSqlCanSeeIt();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_account_approvals",
                Integer.class)).isZero();
        assertThat(staffLogin("co-admin@example.com", "Str0ng-passphrase!")).isEqualTo(200);
    }

    /** The escape closes by itself: same platform, one more administrator, no setting changed. */
    @Test
    @DisplayName("the escape closes the moment a second administrator exists")
    void theEscapeClosesOnceASecondAdministratorExists() throws Exception {
        leaveNoOtherAdministrators();
        User founder = admin("9866040009", "solo2@example.com");
        admin("9866040010", "second@example.com");

        String created = createStaffAs(founder, "9866040011", "second-hire@example.com",
                Roles.Wire.STAFF);
        activate(idOf(created), "Str0ng-passphrase!");

        flushSoRawSqlCanSeeIt();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_account_approvals",
                Integer.class)).isEqualTo(1);
        assertThat(staffLogin("second-hire@example.com", "Str0ng-passphrase!")).isEqualTo(403);
    }

    /** Why {@code approvalIsPossible} counts archived accounts: the narrow reading hands an attacker
     *  the escape — archive the peers one at a time, become sole administrator, mint freely. */
    @Test
    @DisplayName("archiving the other administrator does not re-open the bootstrap escape")
    void archivingThePeerDoesNotReopenTheEscape() throws Exception {
        leaveNoOtherAdministrators();
        User attacker = admin("9866040012", "attacker@example.com");
        User peer = admin("9866040013", "peer3@example.com");
        // Straight to the state the attacker is trying to reach, since the floor in
        // AdministratorGuard is what stops them getting there through the API.
        peer.archive("probe");
        users.saveAndFlush(peer);

        String created = createStaffAs(attacker, "9866040014", "third-hire@example.com",
                Roles.Wire.ADMIN);
        activate(idOf(created), "Str0ng-passphrase!");

        flushSoRawSqlCanSeeIt();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_account_approvals",
                Integer.class)).isEqualTo(1);
        assertThat(staffLogin("third-hire@example.com", "Str0ng-passphrase!")).isEqualTo(403);
    }

    /** Belt-and-braces: {@code role} is in the query's predicate, so cheap coverage of the other
     *  value is worth having — not because it pins something its admin-role twin does not. */
    @Test
    @DisplayName("archiving the peer does not re-open the escape for a staff hire either")
    void archivingThePeerDoesNotReopenTheEscapeForStaff() throws Exception {
        leaveNoOtherAdministrators();
        User attacker = admin("9866040062", "attacker2@example.com");
        User peer = admin("9866040063", "peer9@example.com");
        peer.archive("probe");
        users.saveAndFlush(peer);

        String created = createStaffAs(attacker, "9866040064", "fourth-hire@example.com",
                Roles.Wire.STAFF);
        activate(idOf(created), "Str0ng-passphrase!");

        flushSoRawSqlCanSeeIt();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_account_approvals",
                Integer.class)).isEqualTo(1);
        assertThat(staffLogin("fourth-hire@example.com", "Str0ng-passphrase!")).isEqualTo(403);
    }

    /** The queue exists so a maker-checker rule cannot strand somebody silently. */
    @Test
    @DisplayName("the pending queue lists the held account, with the mobile masked")
    void thePendingQueueListsTheHeldAccount() throws Exception {
        User founder = admin("9866040015", "founder4@example.com");
        admin("9866040016", "peer4@example.com");
        createStaffAs(founder, "9866040017", "queued@example.com", Roles.Wire.STAFF);

        mvc.perform(get(Routes.Users.PENDING_APPROVALS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(founder)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.email == 'queued@example.com')]").exists())
                .andExpect(jsonPath("$[?(@.mobile == '9866040017')]").doesNotExist());
    }

    /** Approving twice is a conflict, not a repeat — see {@code UserAdminService#approve}. */
    @Test
    @DisplayName("approving an already-approved account is a conflict")
    void approvingTwiceIsAConflict() throws Exception {
        User founder = admin("9866040018", "founder5@example.com");
        User peer = admin("9866040019", "peer5@example.com");
        String created = createStaffAs(founder, "9866040020", "twice@example.com",
                Roles.Wire.STAFF);
        String route = Routes.Users.APPROVE.replace("{id}", idOf(created));

        mvc.perform(post(route).header(HttpHeaders.AUTHORIZATION, bearer(peer)))
                .andExpect(status().isOk());
        mvc.perform(post(route).header(HttpHeaders.AUTHORIZATION, bearer(peer)))
                .andExpect(status().isConflict());
    }

    /** A two-key rule enforced only in the service is a one-key rule for any script that bypasses
     *  it. Read from {@code pg_constraint}: provoking it would abort the test's transaction. */
    @Test
    @DisplayName("the database refuses a self-approval even with the service bypassed")
    void theDatabaseRefusesASelfApproval() {
        String definition = jdbc.queryForObject(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = ?",
                String.class, "staff_account_approvals_checker_is_not_maker");

        assertThat(definition.replace(" ", ""))
                .as("the checker-is-not-maker rule must live with the data, not only in the service")
                .contains("approved_by<>created_by");
    }
}
