package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
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

// Audit rows run REQUIRES_NEW and survive class-level rollback, so successful writes clean up after themselves.
@DisplayName("D206 — back-office accounts are activated by their holder, not by their creator")
class StaffInviteTest extends AbstractApiTest {

    private static final String MAKERS_CHOICE = "Maker-chose-this!";

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

    // Sends a password anyway; the request record does not declare the field so Jackson drops it
    // silently — pinned against a stale admin console still calling with it.
    private String createStaffAs(User actor, String mobile, String email, String role)
            throws Exception {
        // A staff account must name a team; an admin resolves to the literal `admin` bundle and must
        // not carry one. Neither is what this class is testing, so the helper keeps the body valid.
        String team = Roles.Wire.STAFF.equals(role) ? ",\"team\":\"" + Teams.RENTAL + "\"" : "";
        String body = mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Minted","mobile":"%s","email":"%s","role":"%s"%s,
                                 "password":"%s"}"""
                                .formatted(mobile, email, role, team, MAKERS_CHOICE)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return body.replaceAll("(?s).*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    // Replace the account's invite hash with the digest of SECRET and return the token its holder
    // would have been sent — the real token is dispatched and never returned to any caller.
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

    // Drive a real OTP sign-in and return verify status; the dispatched code is only logged so the
    // stored hash is replaced with one this test chooses. One call per mobile — OtpService throttles.
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

    @Test
    @DisplayName("the maker cannot sign in as the colleague they had approved")
    void theMakerCannotSignInAsTheColleagueTheyHadApproved() throws Exception {
        User maker = admin("9866041001", "maker@example.com");
        User checker = admin("9866041002", "checker@example.com");

        String hireId = createStaffAs(maker, "9866041003", "hire@example.com", Roles.Wire.ADMIN);
        approve(checker, hireId);

        // 401 rather than 403: no password hash means the credential path refuses before any gate
        // is consulted, indistinguishable from a mistyped password to the maker.
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

    // An account with no password is not unreachable: POST /auth/login needs no password, so a
    // maker who typed their own mobile would hold the account outright once approved.
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

    // Password-set and approval are independent by design; this pins that redeeming does not walk
    // around the second-administrator rule.
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

    // A token that silently reset the password on every presentation would be a permanent
    // credential in somebody's message history — anyone who ever saw the link could take the account back.
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

    // The row carries its own death date so a policy change cannot retroactively extend an
    // invite already in flight.
    @Test
    @DisplayName("an expired invite is refused")
    void anExpiredInviteIsRefused() throws Exception {
        User maker = admin("9866041040", "maker5@example.com");
        String hireId = createStaffAs(maker, "9866041042", "stale@example.com", Roles.Wire.STAFF);

        String token = plantToken(hireId);
        // The CHECK forbids expiring before issue, so backdating expires_at alone would be
        // refused by the schema rather than by the code under test.
        jdbc.update("UPDATE staff_invites SET created_at = now() - interval '30 days',"
                + " expires_at = now() - interval '1 second' WHERE user_id = ?::uuid", hireId);

        assertThat(redeem(token, HOLDERS_CHOICE)).isEqualTo(401);
        assertThat(jdbc.queryForObject("SELECT password_hash FROM users WHERE id = ?::uuid",
                String.class, hireId)).isNull();
    }

    // Every failure must give the same answer or the route becomes an oracle: a distinct
    // "wrong secret" would confirm the guessed selector named a real invite.
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

    // Status, error code and message as one comparable string; traceId is excluded because it
    // is a per-request id that would make every comparison fail for the wrong reason.
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

    // Only a digest is stored (43 base64 chars vs 64 lower-case hex); a dump of this table must not
    // be replayable, on the same reasoning as refresh_tokens.token_hash and otp_codes.code_hash.
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

    // A password nobody can remember gets written down; the floor is on the request so the
    // answer is a 422 naming the field.
    @Test
    @DisplayName("a too-short password is refused with a validation error")
    void aTooShortPasswordIsRefused() throws Exception {
        User maker = admin("9866041070", "maker8@example.com");
        String hireId = createStaffAs(maker, "9866041072", "short@example.com", Roles.Wire.STAFF);

        assertThat(redeem(plantToken(hireId), "short")).isEqualTo(422);
        assertThat(jdbc.queryForObject("SELECT password_hash FROM users WHERE id = ?::uuid",
                String.class, hireId)).isNull();
    }

    // Bootstrap path writes no approval row, so nothing else holds the account shut; if the invite
    // were skipped a sole admin could mint a colleague against their own mobile and sign in by OTP.
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
        // OTP path deliberately: it needs no credential, so it is the only one still open if the
        // invite were skipped here. A password login would 401 for want of a hash and prove nothing.
        assertThat(otpLogin(mobile)).isEqualTo(403);

        assertThat(redeem(plantToken(hireId), HOLDERS_CHOICE)).isEqualTo(204);
        assertThat(staffLogin("bootstrap@example.com", HOLDERS_CHOICE)).isEqualTo(200);
    }

    // Read the CHECK from pg_constraint rather than provoking it: a failed statement aborts the
    // Postgres transaction and every later statement (including cleanup) would then fail.
    @Test
    @DisplayName("the database refuses an invite that expires before it was issued")
    void theDatabaseRefusesAnImpossibleExpiry() {
        String definition = jdbc.queryForObject(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = ?",
                String.class, "staff_invites_expires_after_issue");

        assertThat(definition.replace(" ", "")).contains("expires_at>created_at");
    }
}
