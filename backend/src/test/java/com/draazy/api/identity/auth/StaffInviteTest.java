package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
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
 * D206 — the second signature signs for a <em>person</em>, not a record.
 *
 * <p>D200 stopped one administrator minting a back-office account alone. It did not stop that
 * administrator <strong>choosing the account's password</strong>: {@code StaffCreate} carried a
 * {@code password} field, so a maker could mint "a new ops lead", have a peer approve it in good
 * faith, and then sign in as that ops lead. The peer's name is on the decision and the maker holds
 * the session. Nothing downstream could tell the two apart, because everything the peer was shown —
 * a name, an email, a role — was true.
 *
 * <p>The first test walks exactly that sequence and shows where it now stops. The rest pin the
 * properties the fix rests on: the credential is set by the invitee and nobody else, an
 * un-activated account cannot authenticate on <em>any</em> path, the token is single-use, expiring
 * and stored only as a digest, and every refusal is indistinguishable from every other.
 *
 * <p>Audit rows run {@code REQUIRES_NEW} and survive this class's rollback, so the successful writes
 * clean up after themselves.
 */
@DisplayName("D206 — back-office accounts are activated by their holder, not by their creator")
class StaffInviteTest extends AbstractApiTest {

    /** What a maker would type into the field that used to exist. */
    private static final String MAKERS_CHOICE = "Maker-chose-this!";

    /** What the actual colleague chooses when they redeem. */
    private static final String HOLDERS_CHOICE = "Holder-chose-this!";

    /** The secret half this test plants on an invite row; see {@link #plantToken}. */
    private static final String SECRET = "chosen-by-the-test";

    @Autowired
    UserRepository users;

    @PersistenceContext
    EntityManager em;

    @AfterEach
    void clearCommittedAuditRows() {
        jdbc.update("DELETE FROM audit_log WHERE action LIKE 'user.staff.%'");
    }

    private User admin(String mobile, String email) {
        User user = new User(mobile, Roles.Wire.ADMIN);
        user.setName("Invite probe " + mobile);
        user.setEmail(email);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    /**
     * Mint a colleague, <strong>sending a password the way a pre-D206 client would</strong>.
     *
     * <p>Deliberately still in the body. The request record no longer declares it, so Jackson drops
     * it silently — and that is worth pinning rather than assuming, because a stale admin console is
     * the realistic caller here and the failure mode to avoid is "the field is ignored, but the
     * account gets that password anyway from some other path".
     */
    private String createStaffAs(User actor, String mobile, String email, String role)
            throws Exception {
        String body = mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Minted","mobile":"%s","email":"%s","role":"%s",
                                 "password":"%s"}"""
                                .formatted(mobile, email, role, MAKERS_CHOICE)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return body.replaceAll("(?s).*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    /**
     * Replace the account's invite hash with the digest of {@link #SECRET} and return the token its
     * holder would have been sent.
     *
     * <p>The real token is dispatched through {@code StaffInviteSender} and never returned to any
     * caller — which is the whole point of D206 — so a test cannot read it. Rewriting the stored
     * hash is the same intervention {@code StaffAccountApprovalTest} makes on {@code otp_codes}, and
     * it changes nothing about the verify path under test: the selector, the constant-time
     * comparison and the single-use rule are all still exercised for real.
     */
    private String plantToken(String userId) {
        em.flush();
        String inviteId = jdbc.queryForObject(
                "SELECT id::text FROM staff_invites WHERE user_id = ?::uuid", String.class, userId);
        jdbc.update("UPDATE staff_invites SET token_hash = ? WHERE id = ?::uuid",
                sha256Hex(SECRET), inviteId);
        // Detach, or the rewrite above is invisible to the code under test: Hibernate would resolve
        // the row to the instance it already holds and read the stale in-memory hash.
        em.clear();
        return inviteId + "." + SECRET;
    }

    private int redeem(String token, String password) throws Exception {
        return mvc.perform(post(Routes.Auth.STAFF_INVITE_REDEEM)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"%s\",\"password\":\"%s\"}".formatted(token, password)))
                .andReturn().getResponse().getStatus();
    }

    private int staffLogin(String email, String password) throws Exception {
        return mvc.perform(post(Routes.Auth.STAFF_LOGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, password)))
                .andReturn().getResponse().getStatus();
    }

    /**
     * Drive a real mobile-OTP sign-in and return the status of the verify step.
     *
     * <p>The dispatched code is only ever logged — {@code otp_codes} stores {@code sha256(code)} —
     * so the row's hash is replaced with the hash of a code this test chooses. One call per mobile
     * per test: {@code OtpService} enforces a send cooldown, and a second send would be answered 429
     * for a reason that has nothing to do with D206.
     */
    private int otpLogin(String mobile) throws Exception {
        mvc.perform(post(Routes.Auth.LOGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"%s\"}".formatted(mobile)))
                .andExpect(status().isOk());
        em.flush();
        jdbc.update("""
                UPDATE otp_codes SET code_hash = ?
                WHERE id = (SELECT id FROM otp_codes WHERE mobile = ?
                            ORDER BY created_at DESC LIMIT 1)""",
                sha256Hex("424242"), mobile);
        // Detach, or the rewrite above is invisible: Hibernate would resolve the row to the OtpCode
        // instance it already holds and read the stale in-memory hash.
        em.clear();
        return mvc.perform(post(Routes.Auth.LOGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"%s\",\"otp\":\"424242\"}".formatted(mobile)))
                .andReturn().getResponse().getStatus();
    }

    private void approve(User checker, String userId) throws Exception {
        mvc.perform(post(Routes.Users.APPROVE.replace("{id}", userId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker)))
                .andExpect(status().isOk());
    }

    private static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append("%02x".formatted(b));
            }
            return hex.toString();
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /**
     * The defect, walked end to end.
     *
     * <p>The maker mints a colleague and supplies a password, exactly as they could before. The
     * checker approves in good faith. The maker then tries the credential they chose — and is
     * refused, because they never chose anything: the field was dropped and the account has no
     * password hash at all. Only the person the account is for, holding the invite, can set one.
     */
    @Test
    @DisplayName("the maker cannot sign in as the colleague they had approved")
    void theMakerCannotSignInAsTheColleagueTheyHadApproved() throws Exception {
        User maker = admin("9866041001", "maker@example.com");
        User checker = admin("9866041002", "checker@example.com");

        String hireId = createStaffAs(maker, "9866041003", "hire@example.com", Roles.Wire.ADMIN);
        approve(checker, hireId);

        // Approved, and still unreachable. 401 rather than the activation gate's 403, and the
        // difference is the point: there is no hash for the maker's password to be matched against,
        // so the password path refuses before any gate is consulted. The maker cannot tell an
        // un-activated colleague from a mistyped password, which is the right amount to tell them.
        assertThat(staffLogin("hire@example.com", MAKERS_CHOICE)).isEqualTo(401);
        em.flush();
        assertThat(jdbc.queryForObject("SELECT password_hash FROM users WHERE id = ?::uuid",
                String.class, hireId))
                .as("a back-office account must be created with no usable credential")
                .isNull();

        // The holder redeems, chooses their own password, and only then does the account come alive.
        String token = plantToken(hireId);
        assertThat(redeem(token, HOLDERS_CHOICE)).isEqualTo(204);
        assertThat(staffLogin("hire@example.com", HOLDERS_CHOICE)).isEqualTo(200);
        // And the maker's guess is still just a wrong password, not a way in.
        assertThat(staffLogin("hire@example.com", MAKERS_CHOICE)).isEqualTo(401);
    }

    /**
     * The path the password gate alone would have missed, and the reason the invite blocks token
     * issue rather than merely leaving the account passwordless.
     *
     * <p>An account with no password is <em>not</em> unreachable. It has a mobile number, and
     * {@code POST /auth/login} needs no password whatsoever — so a maker who typed their own number
     * into the create form would hold the account outright the moment the checker approved it, and
     * the checker would have had no way to see it. The account here is fully approved; the only
     * thing standing in the way is the open invite.
     */
    @Test
    @DisplayName("an un-activated account cannot sign in by OTP either, even once approved")
    void anUnactivatedAccountCannotSignInByOtp() throws Exception {
        User maker = admin("9866041010", "maker2@example.com");
        User checker = admin("9866041011", "checker2@example.com");
        String mobile = "9866041012";
        String hireId = createStaffAs(maker, mobile, "otp-hire@example.com", Roles.Wire.STAFF);
        approve(checker, hireId);

        assertThat(otpLogin(mobile)).isEqualTo(403);
    }

    /**
     * Redeeming is not a login, and it is not an approval.
     *
     * <p>The two gates are independent by design — a colleague can set their password the day they
     * are told about the job, and the approval decision stays with the administrators. This pins
     * that setting a password does not walk around D200, which would have been an easy and
     * catastrophic way to implement the same feature.
     */
    @Test
    @DisplayName("redeeming an invite does not bypass the second administrator")
    void redeemingDoesNotBypassApproval() throws Exception {
        User maker = admin("9866041020", "maker3@example.com");
        User checker = admin("9866041021", "checker3@example.com");
        String hireId = createStaffAs(maker, "9866041022", "eager@example.com", Roles.Wire.STAFF);

        assertThat(redeem(plantToken(hireId), HOLDERS_CHOICE)).isEqualTo(204);
        assertThat(staffLogin("eager@example.com", HOLDERS_CHOICE))
                .as("a redeemed but unapproved account must still be refused")
                .isEqualTo(403);

        approve(checker, hireId);
        assertThat(staffLogin("eager@example.com", HOLDERS_CHOICE)).isEqualTo(200);
    }

    /**
     * Single use. The second presentation of a spent token is refused, and — the part worth
     * asserting — it does not change the password either.
     *
     * <p>A token that quietly resets the password every time it is presented is not an invite, it is
     * a permanent credential in somebody's message history. Anyone who ever saw the link (a
     * forwarded SMS, a shared handset) could take the account back at any time.
     */
    @Test
    @DisplayName("an invite is single-use — a second redemption is refused and changes nothing")
    void anInviteIsSingleUse() throws Exception {
        User maker = admin("9866041030", "maker4@example.com");
        User checker = admin("9866041031", "checker4@example.com");
        String hireId = createStaffAs(maker, "9866041032", "once@example.com", Roles.Wire.STAFF);
        approve(checker, hireId);

        String token = plantToken(hireId);
        assertThat(redeem(token, HOLDERS_CHOICE)).isEqualTo(204);
        assertThat(redeem(token, "Attackers-choice!")).isEqualTo(401);

        assertThat(staffLogin("once@example.com", HOLDERS_CHOICE)).isEqualTo(200);
        assertThat(staffLogin("once@example.com", "Attackers-choice!")).isEqualTo(401);
    }

    /**
     * An invite that never expires is a credential lying around forever. The row carries its own
     * death date, so a policy change cannot retroactively extend one already in flight.
     */
    @Test
    @DisplayName("an expired invite is refused")
    void anExpiredInviteIsRefused() throws Exception {
        User maker = admin("9866041040", "maker5@example.com");
        String hireId = createStaffAs(maker, "9866041042", "stale@example.com", Roles.Wire.STAFF);

        String token = plantToken(hireId);
        // created_at moves with it: the row's own CHECK forbids an invite that died before it was
        // issued, so a test that only backdated expires_at would be refused by the schema rather
        // than by the code it means to exercise.
        jdbc.update("UPDATE staff_invites SET created_at = now() - interval '30 days',"
                + " expires_at = now() - interval '1 second' WHERE user_id = ?::uuid", hireId);

        assertThat(redeem(token, HOLDERS_CHOICE)).isEqualTo(401);
        assertThat(jdbc.queryForObject("SELECT password_hash FROM users WHERE id = ?::uuid",
                String.class, hireId)).isNull();
    }

    /**
     * Every failure gives the same answer.
     *
     * <p>An unknown selector, a wrong secret and a malformed token must be indistinguishable, or the
     * route is an oracle: a distinct "wrong secret" would confirm that a guessed selector named a
     * real invite, which is exactly the half of the token an attacker can enumerate.
     */
    @Test
    @DisplayName("unknown, wrong and malformed tokens are refused identically")
    void everyRefusalLooksTheSame() throws Exception {
        User maker = admin("9866041050", "maker6@example.com");
        String hireId = createStaffAs(maker, "9866041052", "probe@example.com", Roles.Wire.STAFF);
        String valid = plantToken(hireId);
        String selector = valid.substring(0, valid.indexOf('.'));

        String wrongSecret = body(selector + ".not-the-secret");
        String unknownSelector = body("11111111-1111-1111-1111-111111111111.whatever");
        String notAUuid = body("definitely-not-a-uuid.whatever");
        String noSeparator = body("nosecrethere");

        assertThat(wrongSecret).isEqualTo(unknownSelector)
                .isEqualTo(notAUuid).isEqualTo(noSeparator);
        assertThat(wrongSecret).contains("401");
    }

    /**
     * The status, error code and message of a refused redemption, as one comparable string.
     *
     * <p>{@code traceId} is deliberately excluded: it is a per-request correlation id, so including
     * it would make every comparison fail for a reason that has nothing to do with what the caller
     * can learn from the answer.
     */
    private String body(String token) throws Exception {
        var response = mvc.perform(post(Routes.Auth.STAFF_INVITE_REDEEM)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"%s\",\"password\":\"%s\"}"
                                .formatted(token, HOLDERS_CHOICE)))
                .andReturn().getResponse();
        String json = response.getContentAsString();
        return response.getStatus()
                + " " + field(json, "error")
                + " " + field(json, "message");
    }

    private static String field(String json, String name) {
        return json.replaceAll("(?s).*\"" + name + "\"\\s*:\\s*\"([^\"]*)\".*", "$1");
    }

    /**
     * The token is not in the database — only a digest of its secret half is.
     *
     * <p>A raw token is 43 URL-safe base64 characters; the stored value is 64 lower-case hex. The
     * two cannot be confused, which is what makes this assertion worth making rather than eyeballing
     * the entity: a dump of this table must not be replayable, on the same reasoning as
     * {@code refresh_tokens.token_hash} and {@code otp_codes.code_hash}.
     */
    @Test
    @DisplayName("only a digest of the invite secret is persisted")
    void onlyADigestIsPersisted() throws Exception {
        User maker = admin("9866041060", "maker7@example.com");
        String hireId = createStaffAs(maker, "9866041062", "digest@example.com", Roles.Wire.STAFF);

        em.flush();
        assertThat(jdbc.queryForObject("SELECT token_hash FROM staff_invites WHERE user_id = ?::uuid",
                String.class, hireId))
                .as("a raw token in this column would be replayable straight out of a backup")
                .matches("^[0-9a-f]{64}$");
    }

    /**
     * A password nobody can remember gets written down; a password of four characters is not one.
     * The floor is on the request so the answer is a 422 naming the field.
     */
    @Test
    @DisplayName("a too-short password is refused with a validation error")
    void aTooShortPasswordIsRefused() throws Exception {
        User maker = admin("9866041070", "maker8@example.com");
        String hireId = createStaffAs(maker, "9866041072", "short@example.com", Roles.Wire.STAFF);

        assertThat(redeem(plantToken(hireId), "short")).isEqualTo(422);
        assertThat(jdbc.queryForObject("SELECT password_hash FROM users WHERE id = ?::uuid",
                String.class, hireId)).isNull();
    }

    /**
     * The invite is issued on the bootstrap path too — the one case that would otherwise still be
     * broken.
     *
     * <p>When no other administrator exists, D200's escape writes no approval row, so nothing else
     * is holding the account shut. If the invite were skipped there as well, the sole administrator
     * could mint a colleague against their own mobile number and sign in as them by OTP, which is
     * the whole of D206 reappearing on the one path nobody watches.
     */
    @Test
    @DisplayName("the bootstrap escape still issues an invite")
    void theBootstrapEscapeStillIssuesAnInvite() throws Exception {
        jdbc.update("UPDATE users SET role = 'buyer' WHERE role = 'admin'");
        User solo = admin("9866041080", "solo@example.com");
        String mobile = "9866041082";

        String hireId = createStaffAs(solo, mobile, "bootstrap@example.com", Roles.Wire.STAFF);

        em.flush();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_account_approvals",
                Integer.class))
                .as("premise: this is the escape path, so there is no approval row")
                .isZero();
        // The OTP path, deliberately: it is the one that needs no credential, so it is the only one
        // that would still be open if the invite were skipped here. A password login would answer
        // 401 for want of a hash and prove nothing about the gate.
        assertThat(otpLogin(mobile)).isEqualTo(403);

        assertThat(redeem(plantToken(hireId), HOLDERS_CHOICE)).isEqualTo(204);
        assertThat(staffLogin("bootstrap@example.com", HOLDERS_CHOICE)).isEqualTo(200);
    }

    /**
     * The second fence, in the database.
     *
     * <p>Read from {@code pg_constraint} rather than provoked: a failed statement aborts the
     * PostgreSQL transaction, and every later statement in the test — including the {@code @AfterEach}
     * cleanup — would then fail for a reason that has nothing to do with what was being tested.
     */
    @Test
    @DisplayName("the database refuses an invite that expires before it was issued")
    void theDatabaseRefusesAnImpossibleExpiry() {
        String definition = jdbc.queryForObject(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = ?",
                String.class, "staff_invites_expires_after_issue");

        assertThat(definition.replace(" ", "")).contains("expires_at>created_at");
    }
}
