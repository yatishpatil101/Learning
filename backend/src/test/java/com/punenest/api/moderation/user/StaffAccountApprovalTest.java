package com.punenest.api.moderation.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.access.BackOfficeGrant;
import com.punenest.api.common.access.BackOfficeGrantRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.auth.RefreshCookie;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
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

/**
 * D200, half 2 — a back-office account minted through {@code POST /users/staff} cannot authenticate
 * until a <em>second</em> administrator approves it.
 *
 * <p>The first test is the whole reason this exists: it walks the escalation D200 describes, step by
 * individually-authorised step, and shows where it now stops. Every call in that sequence is
 * legitimate on its own — which is exactly why no audit rule could have caught it, and why the fix
 * had to be a refusal rather than an alert.
 *
 * <p>Audit rows run {@code REQUIRES_NEW} and survive this class's rollback, so the successful writes
 * clean up after themselves.
 */
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

    /**
     * Push pending JPA writes down to the database so this test's raw SQL can see them.
     *
     * <p>Needed because the writes and the reads are in the <em>same</em> transaction but not the
     * same layer. {@code OtpService.sendCode} and {@code UserAdminService.createStaff} participate
     * in the transaction this test owns and call {@code save}, which only stages the row in the
     * persistence context; {@code jdbc} then issues SQL on that same connection and legitimately
     * finds nothing. Nothing is wrong with the production path — a real request commits, and every
     * assertion here that goes back through the API passes already, because JPQL auto-flushes before
     * it reads. Only the raw-SQL assertions need this.
     *
     * <p>Without it the failure is a liar: the approval row appears to have never been written, and
     * the OTP tests report {@code 401 invalid code} — which looks like the D200 gate refusing a
     * login it never actually reached.
     */
    private void flushSoRawSqlCanSeeIt() {
        em.flush();
    }

    /**
     * The bootstrap escape counts <em>every</em> admin-role row on the platform, so a test that
     * needs "there is another administrator" to be false has to say so explicitly. Demoting rather
     * than deleting keeps every foreign key intact, and the class-level rollback undoes it.
     */
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

    private String createStaffAs(User actor, String mobile, String email, String role)
            throws Exception {
        return mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Minted","mobile":"%s","email":"%s","role":"%s"}"""
                                .formatted(mobile, email, role)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    /**
     * Put a password on a freshly minted account the way its holder would — by redeeming the invite.
     *
     * <p><strong>Every password-login assertion in this class depends on this being called first,
     * and that is the point.</strong> Since D206 nobody can hand a back-office account a password at
     * creation time: {@code StaffCreate} has no such field, so an un-activated account has a null
     * {@code password_hash} and {@code staffLogin} answers 401 for a reason that has nothing to do
     * with maker-checker. Activating first is what keeps a 403 here meaning "held for approval".
     *
     * <p>The delivered token is only ever dispatched through {@code StaffInviteSender}, so the row's
     * hash is replaced with the hash of a secret this test chooses — the same intervention
     * {@link #otpLogin} makes on {@code otp_codes}, and narrower than it looks: nothing about the
     * verify path under test changes, and the alternative couples the test to a log format.
     */
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

    /**
     * Drive a real mobile-OTP sign-in and return the status of the verify step.
     *
     * <p>The dispatched code is only ever logged — {@code otp_codes} stores {@code sha256(code)} —
     * so the row's hash is replaced with the hash of a code this test chooses. That is a narrower
     * intervention than it looks: it changes nothing about the flow being exercised, and the
     * alternative (parsing the mock sender's log line) couples the test to a log format.
     */
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
        // Detach everything, or the rewrite above is invisible to the code under test. The OtpCode
        // just saved is still managed here, and Hibernate resolves a JPQL result row to the instance
        // it already holds for that id — the freshly-read code_hash column is discarded in favour of
        // the stale in-memory one, and the verify answers 401 against a hash this test replaced.
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

    /**
     * The refresh token an auth response issued, as the cookie it now travels in.
     *
     * <p>Returns the {@code Cookie} rather than its value so callers hand it straight back to the
     * next request: what is being exercised is the round trip a browser would make, and a test that
     * unwrapped the value and rewrapped it by hand would keep passing if the server stopped setting
     * the cookie at all.
     */
    private Cookie refreshCookieOf(MockHttpServletResponse response) {
        Cookie cookie = response.getCookie(cookies.name());
        assertThat(cookie).as("auth response should carry a refresh cookie").isNotNull();
        return cookie;
    }

    @AfterEach
    void clearCommittedAuditRows() {
        jdbc.update("DELETE FROM audit_log WHERE action LIKE 'user.staff.%'");
    }

    /**
     * The escalation, walked end to end.
     *
     * <p>A narrowed administrator keeps {@code users:write} — that is the premise, and it is the
     * realistic one: an ops lead scoped out of finance and settings still needs to manage the desk.
     * Before this change it could mint a fresh administrator, which has no permission document and
     * therefore resolves to the full role baseline, sign in as it, and recover everything it had
     * just been scoped out of.
     */
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

        // ...but it can still mint a colleague, which is the surface D200 is about.
        String created = createStaffAs(narrowed, "9866040003", "minted@example.com",
                Roles.Wire.ADMIN);
        String mintedId = idOf(created);
        // Activated by its holder, so the only thing left standing between it and a session is the
        // approval. Without this the 403s below would be D206's gate, not D200's.
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

    /**
     * Holding an account must also stop the session it already has.
     *
     * <p>This is the case the gate on {@code /auth/refresh} exists for, and the one the other tests
     * cannot reach: every account they hold is held at the instant it is created, so it never has a
     * token to refresh. Placing a hold on an <em>existing</em> account is the obvious
     * incident-response use of the table — and until 2026-08-11 that account kept minting access
     * tokens from its refresh token for the whole TTL, because {@code refresh} mints directly rather
     * than through the funnel the two login paths share. The account here signs in first and is held
     * afterwards, which is the only ordering that tells the two implementations apart.
     */
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

        // The session is live before the hold — otherwise this proves nothing about refresh. The
        // rotated cookie has to be carried forward: the one just spent is revoked, and presenting it
        // again would answer 401 for reuse regardless of whether the gate below exists.
        Cookie rotated = refreshCookieOf(mvc.perform(post(Routes.Auth.REFRESH).cookie(session))
                .andExpect(status().isOk())
                .andReturn().getResponse());

        // The hold, placed by hand on a live account. There is no route that does this yet — which
        // is D205, and is why the gate it depends on needs a test of its own now rather than later.
        jdbc.update("UPDATE staff_account_approvals SET approved_by = NULL, approved_at = NULL"
                + " WHERE user_id = ?::uuid", servingId);

        assertThat(mvc.perform(post(Routes.Auth.REFRESH).cookie(rotated))
                .andReturn().getResponse().getStatus()).isEqualTo(403);
    }

    /**
     * The refusal that most deserves a record is the one that leaves no other trace.
     *
     * <p>A successful approval writes {@code user.staff.approve}. A maker trying to wave through
     * their own hire writes nothing at all until this test existed — the account simply stayed held,
     * which looks identical to nobody having got round to it. It is either a confused colleague or
     * the exact move maker-checker exists to stop, and the two are indistinguishable after the fact
     * without the row.
     */
    @Test
    @DisplayName("a maker's attempt to approve their own hire is written to the audit log")
    void theSelfApprovalRefusalIsAudited() throws Exception {
        User founder = admin("9866040065", "founder6@example.com");
        // A second administrator has to exist or the hire is never held at all: with one
        // administrator the bootstrap escape fires, no approval row is written, and approving an
        // account that was never pending answers 409 rather than reaching the refusal under test.
        admin("9866040073", "peer8@example.com");
        String created = createStaffAs(founder, "9866040066", "self-approve@example.com",
                Roles.Wire.STAFF);
        String hireId = idOf(created);

        assertThat(mvc.perform(post(Routes.Users.APPROVE.replace("{id}", hireId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(founder)))
                .andReturn().getResponse().getStatus()).isEqualTo(403);

        // Committed by AuditService's own REQUIRES_NEW transaction, so it is visible to raw SQL
        // without a flush here — and survives the 403 for the same reason. Scoped to this account
        // rather than counted globally: the @AfterEach cleanup runs inside the test transaction and
        // is rolled back with it, so refusals written by sibling tests are still in the table.
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM audit_log"
                        + " WHERE action = 'user.staff.approve.refused' AND entity_id = ?",
                Integer.class, hireId)).isEqualTo(1);
    }

    /**
     * A valid token is not proof that the bearer is still an administrator.
     *
     * <p>Role and {@code users:write} are re-resolved from the database on every request, so
     * narrowing an account takes effect at once. Archiving one does not: the access token it already
     * holds stays cryptographically valid until it expires. Approving a colleague is exactly the
     * gesture that should not survive being shown the door.
     */
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

    /**
     * The path an attacker would actually take, and the reason the gate sits in {@code issueFor}
     * rather than in {@code staffLogin}.
     *
     * <p>A minted account has a mobile number, and mobile-OTP login needs no password at all. A gate
     * on the password path alone would have refused the door the attacker was never going to use.
     */
    @Test
    @DisplayName("the held account cannot sign in by OTP either")
    void theHeldAccountCannotSignInByOtp() throws Exception {
        User founder = admin("9866040004", "founder2@example.com");
        admin("9866040005", "peer2@example.com");
        String mobile = "9866040006";
        String created = createStaffAs(founder, mobile, "minted2@example.com", Roles.Wire.STAFF);
        // Activated, so the refusal below can only be the approval gate. An un-activated account is
        // refused too (D206), which would make this pass without D200 existing at all.
        activate(idOf(created), "Str0ng-passphrase!");

        assertThat(otpLogin(mobile)).isEqualTo(403);
    }

    /**
     * The positive control for the test above, and the proof that the gate is not simply refusing
     * every OTP login. Same account shape, same path, one approval apart.
     *
     * <p>A separate test rather than a second half of that one because {@code OtpService} enforces a
     * send cooldown per mobile: two sends for the same number inside one test would be answered 429
     * and the assertion would fail for a reason that has nothing to do with D200.
     */
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

    /**
     * The bootstrap escape. A rule nobody can satisfy is a lockout, not a control — the first
     * administrator on a fresh install has no peer to co-sign with.
     */
    @Test
    @DisplayName("the only administrator on the platform is not held by a rule nobody can satisfy")
    void theSoleAdministratorIsNotHeld() throws Exception {
        leaveNoOtherAdministrators();
        User founder = admin("9866040007", "solo@example.com");

        String created = createStaffAs(founder, "9866040008", "first-hire@example.com",
                Roles.Wire.STAFF);
        activate(idOf(created), "Str0ng-passphrase!");

        // Flushed even though this one expects zero: unflushed, it would report zero whether or not
        // the escape worked, and pass for a reason that has nothing to do with D200.
        flushSoRawSqlCanSeeIt();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_account_approvals",
                Integer.class)).isZero();
        assertThat(staffLogin("first-hire@example.com", "Str0ng-passphrase!")).isEqualTo(200);
    }

    /**
     * The same escape, for the role that actually matters — and the one the original implementation
     * got wrong.
     *
     * <p>{@code approvalIsPossible} counts {@code role = 'admin'} accounts other than the creator.
     * Ask it <em>after</em> inserting the new user and the new admin counts itself, so a lone
     * founder promoting their first colleague to administrator produced a held account that only
     * the founder (refused as the maker) or the colleague (unable to sign in) could clear: a
     * permanent lockout, on precisely the path the escape exists to keep open. It survived review
     * because {@code theSoleAdministratorIsNotHeld} above creates a <em>staff</em> account, which
     * does not match the count's predicate and therefore never self-counts. <strong>Two tests that
     * differ only by a role argument are not redundant when a query filters on that role.</strong>
     */
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

    /**
     * The escape closes by itself. Same platform, one more administrator — and the identical call
     * now produces a held account, without anybody changing a setting.
     */
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

    /**
     * Archiving a peer must not re-open the escape.
     *
     * <p>This is the interlock between the two halves of D200, and the reason
     * {@code approvalIsPossible} counts archived accounts. The narrow reading — "is there another
     * administrator who could approve <em>right now</em>" — would hand the attacker the escape:
     * archive the peers one at a time, become the sole administrator, then mint freely.
     */
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

    /**
     * The same interlock with a staff hire, so the assertion cannot lean on the created account.
     *
     * <p>Belt-and-braces rather than a second proof, and worth being honest about which. Before the
     * ordering fix in {@code addStaff} these two differed materially: the admin-role version counted
     * the account it had just created, so it would have stayed green even with an {@code archived}
     * filter on {@code countByRoleExcluding} — the very filter it exists to forbid — while this one
     * would have gone red. The fix removed that asymmetry, and now both go red under that mutation.
     * Kept because {@code role} is in the query's predicate and cheap coverage of the other value is
     * worth having, not because it pins something its twin does not.
     */
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

    /**
     * The second fence. The service produces the useful 403, but a two-key rule enforced in exactly
     * one place is a one-key rule with extra steps — the repair script or batch job that bypasses
     * the service is always the one nobody remembered to look at.
     *
     * <p>Asserted by reading {@code pg_constraint} rather than by provoking the violation. A failed
     * statement puts the PostgreSQL transaction into its aborted state, and every later statement in
     * the test — including this class's {@code @AfterEach} cleanup — would then fail for a reason
     * that has nothing to do with what was being tested.
     */
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
