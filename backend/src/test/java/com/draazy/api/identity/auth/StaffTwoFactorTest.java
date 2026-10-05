package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import com.draazy.api.support.StaffSignIn;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@DisplayName("Back-office sign-in — password, then an authenticator code")
class StaffTwoFactorTest extends AbstractApiTest {

    private static final String PASSWORD = "Str0ng-passphrase!";
    private final ObjectMapper json = new ObjectMapper();

    @Autowired
    UserRepository users;
    @Autowired
    PasswordEncoder passwordEncoder;
    @Autowired
    JdbcTemplate jdbc;
    @PersistenceContext
    EntityManager em;

    private User backOffice(String role, String mobile, String email) {
        User user = new User(mobile, role);
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(PASSWORD));
        if (Roles.Wire.STAFF.equals(role)) {
            user.setTeam("rental");
        }
        return users.saveAndFlush(user);
    }

    private JsonNode read(MockHttpServletResponse response) throws Exception {
        return json.readTree(response.getContentAsString());
    }

    /** Enrols the account and returns its secret, leaving the confirm step's code as consumed. */
    private byte[] enrolled(String email) throws Exception {
        String challenge = StaffSignIn.password(mvc, email, PASSWORD).get("challenge").asText();
        byte[] secret = StaffSignIn.enrol(mvc, challenge);
        assertThat(StaffSignIn.submit(mvc, Routes.Auth.STAFF_LOGIN_ENROL_CONFIRM, challenge,
                StaffSignIn.codeNow(secret)).getStatus()).isEqualTo(200);
        return secret;
    }

    private String challenge(String email) throws Exception {
        return StaffSignIn.password(mvc, email, PASSWORD).get("challenge").asText();
    }

    private static String nextCode(byte[] secret) {
        return Totp.code(secret, Totp.stepAt(Instant.now()) + 1);
    }

    @Test
    @DisplayName("RFC 6238 test vectors, truncated to six digits")
    void totpMatchesTheRfcVectors() {
        byte[] secret = "12345678901234567890".getBytes();
        assertThat(Totp.code(secret, 59 / 30)).isEqualTo("287082");
        assertThat(Totp.code(secret, 1111111109L / 30)).isEqualTo("081804");
        assertThat(Totp.code(secret, 1234567890L / 30)).isEqualTo("005924");
        assertThat(StaffSignIn.decodeBase32(Totp.base32(secret))).isEqualTo(secret);
    }

    @Test
    @DisplayName("first sign-in enrols, returns tokens once with ten recovery codes")
    void firstSignInEnrolsAndReturnsRecoveryCodes() throws Exception {
        backOffice(Roles.Wire.STAFF, "9866050001", "first@example.com");

        String challenge = challenge("first@example.com");
        assertThat(mvc.perform(post(Routes.Auth.STAFF_LOGIN_ENROL).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"challenge\":\"%s\"}".formatted(challenge)))
                .andReturn().getResponse().getContentAsString())
                .as("the authenticator entry names the environment")
                .contains("otpauth://totp/Draazy%20Local%3Afirst%40example.com")
                .contains("issuer=Draazy%20Local");

        MockHttpServletResponse confirmed = StaffSignIn.firstSignIn(mvc, "first@example.com", PASSWORD);

        assertThat(confirmed.getStatus()).isEqualTo(200);
        JsonNode body = read(confirmed);
        assertThat(body.get("accessToken").asText()).isNotBlank();
        assertThat(body.get("recoveryCodes")).hasSize(10);
        assertThat(confirmed.getHeader(HttpHeaders.SET_COOKIE)).isNotBlank();
        assertThat(StaffSignIn.password(mvc, "first@example.com", PASSWORD).get("mfa").asText())
                .isEqualTo("totp");
    }

    @Test
    @DisplayName("an authenticator code signs in once; the same code cannot be replayed")
    void aCodeWorksOnceOnly() throws Exception {
        backOffice(Roles.Wire.ADMIN, "9866050002", "replay@example.com");
        byte[] secret = enrolled("replay@example.com");
        String code = nextCode(secret);

        assertThat(StaffSignIn.submit(mvc, Routes.Auth.STAFF_LOGIN_VERIFY,
                challenge("replay@example.com"), code).getStatus()).isEqualTo(200);
        assertThat(StaffSignIn.submit(mvc, Routes.Auth.STAFF_LOGIN_VERIFY,
                challenge("replay@example.com"), code).getStatus()).isEqualTo(401);
    }

    @Test
    @DisplayName("a recovery code signs in exactly once")
    void aRecoveryCodeIsSingleUse() throws Exception {
        backOffice(Roles.Wire.STAFF, "9866050003", "recovery@example.com");
        String challenge = challenge("recovery@example.com");
        byte[] secret = StaffSignIn.enrol(mvc, challenge);
        String recovery = read(StaffSignIn.submit(mvc, Routes.Auth.STAFF_LOGIN_ENROL_CONFIRM,
                challenge, StaffSignIn.codeNow(secret))).get("recoveryCodes").get(0).asText();

        assertThat(StaffSignIn.submit(mvc, Routes.Auth.STAFF_LOGIN_VERIFY,
                challenge("recovery@example.com"), recovery.toUpperCase()).getStatus()).isEqualTo(200);
        assertThat(StaffSignIn.submit(mvc, Routes.Auth.STAFF_LOGIN_VERIFY,
                challenge("recovery@example.com"), recovery).getStatus()).isEqualTo(401);
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    @DisplayName("concurrent attempts with one recovery code sign in exactly once")
    void concurrentRecoveryCodeUseSignsInOnce() throws Exception {
        String mobile = "9866050013";
        deleteCommittedUser(mobile);
        try {
            raceOneRecoveryCode();
        } finally {
            deleteCommittedUser(mobile);
        }
    }

    private void deleteCommittedUser(String mobile) {
        jdbc.update("DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE mobile = ?)", mobile);
        jdbc.update("DELETE FROM users WHERE mobile = ?", mobile);
    }

    private void raceOneRecoveryCode() throws Exception {
        backOffice(Roles.Wire.STAFF, "9866050013", "race@example.com");
        String challenge = challenge("race@example.com");
        byte[] secret = StaffSignIn.enrol(mvc, challenge);
        String recovery = read(StaffSignIn.submit(mvc, Routes.Auth.STAFF_LOGIN_ENROL_CONFIRM,
                challenge, StaffSignIn.codeNow(secret))).get("recoveryCodes").get(0).asText();
        String verifyChallenge = challenge("race@example.com");

        int racers = 12;
        CountDownLatch ready = new CountDownLatch(racers);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(racers);
        try {
            List<Future<Integer>> results = new ArrayList<>();
            for (int i = 0; i < racers; i++) {
                results.add(pool.submit(() -> {
                    ready.countDown();
                    start.await();
                    return StaffSignIn.submit(mvc, Routes.Auth.STAFF_LOGIN_VERIFY, verifyChallenge, recovery)
                            .getStatus();
                }));
            }
            ready.await();
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> result : results) {
                statuses.add(result.get(30, TimeUnit.SECONDS));
            }
            assertThat(statuses).containsOnlyOnce(200);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("five misses lock the account, and the lock answers the same whatever the password")
    void fiveMissesLockTheAccount() throws Exception {
        backOffice(Roles.Wire.STAFF, "9866050004", "lockout@example.com");
        byte[] secret = enrolled("lockout@example.com");
        String challenge = challenge("lockout@example.com");
        String wrong = Totp.code(secret, Totp.stepAt(Instant.now()) + 5);
        for (int i = 0; i < 5; i++) {
            assertThat(StaffSignIn.submit(mvc, Routes.Auth.STAFF_LOGIN_VERIFY, challenge, wrong)
                    .getStatus()).isEqualTo(401);
        }

        mvc.perform(post(Routes.Auth.STAFF_LOGIN_VERIFY).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"challenge\":\"%s\",\"code\":\"%s\"}"
                                .formatted(challenge, nextCode(secret))))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("staff_sign_in_locked"));
        mvc.perform(post(Routes.Auth.STAFF_LOGIN).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"lockout@example.com\",\"password\":\"%s\"}"
                                .formatted(PASSWORD)))
                .andExpect(status().isTooManyRequests());
        mvc.perform(post(Routes.Auth.STAFF_LOGIN).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"lockout@example.com\",\"password\":\"wrong-guess\"}"))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("wrong passwords count toward the same lock")
    void wrongPasswordsCountTowardTheLock() throws Exception {
        backOffice(Roles.Wire.STAFF, "9866050005", "guessed@example.com");
        for (int i = 0; i < 5; i++) {
            mvc.perform(post(Routes.Auth.STAFF_LOGIN).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"email\":\"guessed@example.com\",\"password\":\"guess-" + i + "\"}"))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(post(Routes.Auth.STAFF_LOGIN).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"guessed@example.com\",\"password\":\"%s\"}"
                                .formatted(PASSWORD)))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("a forged or tampered challenge is refused")
    void aTamperedChallengeIsRefused() throws Exception {
        backOffice(Roles.Wire.STAFF, "9866050006", "tamper@example.com");
        String challenge = challenge("tamper@example.com");
        String forged = challenge.substring(0, challenge.length() - 2) + "AA";

        mvc.perform(post(Routes.Auth.STAFF_LOGIN_ENROL).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"challenge\":\"%s\"}".formatted(forged)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("staff_sign_in_expired"));
    }

    @Test
    @DisplayName("an enrolled account cannot be re-enrolled from the sign-in page")
    void anEnrolledAccountCannotReEnrol() throws Exception {
        backOffice(Roles.Wire.STAFF, "9866050007", "twice@example.com");
        enrolled("twice@example.com");

        mvc.perform(post(Routes.Auth.STAFF_LOGIN_ENROL).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"challenge\":\"%s\"}".formatted(challenge("twice@example.com"))))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("the mobile-OTP route refuses back-office accounts after a correct code")
    void otpLoginRefusesBackOfficeAccounts() throws Exception {
        String mobile = "9866050008";
        backOffice(Roles.Wire.ADMIN, mobile, "otp-admin@example.com");
        mvc.perform(post(Routes.Auth.LOGIN).contentType(MediaType.APPLICATION_JSON)
                .content("{\"mobile\":\"%s\"}".formatted(mobile))).andExpect(status().isOk());
        em.flush();
        jdbc.update("""
                UPDATE otp_codes SET code_hash = ?
                WHERE id = (SELECT id FROM otp_codes WHERE mobile = ? ORDER BY created_at DESC LIMIT 1)""",
                Tokens.sha256Hex("424242"), mobile);
        em.clear();

        mvc.perform(post(Routes.Auth.LOGIN).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"%s\",\"otp\":\"424242\"}".formatted(mobile)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("staff_sign_in_required"))
                .andExpect(jsonPath("$.accessToken").doesNotExist());
    }

    @Test
    @DisplayName("an administrator resets a colleague's authenticator and ends their sessions")
    void adminResetsAColleaguesAuthenticator() throws Exception {
        User admin = backOffice(Roles.Wire.ADMIN, "9866050009", "reset-admin@example.com");
        User staff = backOffice(Roles.Wire.STAFF, "9866050010", "lost-phone@example.com");
        enrolled("lost-phone@example.com");

        mvc.perform(post(Routes.Users.RESET_TWO_FACTOR.replace("{id}", staff.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk());

        assertThat(StaffSignIn.password(mvc, "lost-phone@example.com", PASSWORD).get("mfa").asText())
                .isEqualTo("enrol");
        em.flush();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM refresh_tokens WHERE user_id = ?"
                + " AND NOT revoked", Integer.class, staff.getId())).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_log WHERE action = ?"
                + " AND entity_id = ?", Integer.class, "user.staff.2fa.reset",
                staff.getId().toString())).isEqualTo(1);
    }

    @Test
    @DisplayName("reset is refused on oneself, on consumers, and to staff callers")
    void resetIsRefusedWhereItMakesNoSense() throws Exception {
        User admin = backOffice(Roles.Wire.ADMIN, "9866050011", "self-admin@example.com");
        User staff = backOffice(Roles.Wire.STAFF, "9866050012", "caller@example.com");
        User buyer = users.saveAndFlush(new User("9866050013", Roles.Wire.BUYER));

        mvc.perform(post(Routes.Users.RESET_TWO_FACTOR.replace("{id}", admin.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isForbidden());
        mvc.perform(post(Routes.Users.RESET_TWO_FACTOR.replace("{id}", buyer.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isConflict());
        mvc.perform(post(Routes.Users.RESET_TWO_FACTOR.replace("{id}", admin.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a reissued invite stops the old password until the new one is set")
    void aReissuedInviteBlocksTheOldPassword() throws Exception {
        User admin = backOffice(Roles.Wire.ADMIN, "9866050014", "invite-admin@example.com");
        User staff = backOffice(Roles.Wire.STAFF, "9866050015", "forgot@example.com");

        mvc.perform(post(Routes.Users.REISSUE_INVITE.replace("{id}", staff.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk());
        mvc.perform(post(Routes.Users.REISSUE_INVITE.replace("{id}", staff.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk());

        em.flush();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_invites WHERE user_id = ?"
                + " AND redeemed_at IS NULL", Integer.class, staff.getId())).isEqualTo(1);
        mvc.perform(post(Routes.Auth.STAFF_LOGIN).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"forgot@example.com\",\"password\":\"%s\"}"
                                .formatted(PASSWORD)))
                .andExpect(status().isForbidden());
    }
}
