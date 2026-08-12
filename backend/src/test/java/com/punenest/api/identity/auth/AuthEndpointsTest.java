package com.punenest.api.identity.auth;

import com.punenest.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.punenest.api.common.web.RequestCorrelation;
import com.punenest.api.provider.OtpSender;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Contract + behavior proof for the four auth endpoints through the real filter chain. Uses a
 * capturing {@link OtpSender} so the deterministic dev OTP can be read back and the full send→verify
 * round-trip exercised without any external dependency.
 */
class AuthEndpointsTest extends AbstractApiTest {

    // why: Boot 4 test contexts don't expose an ObjectMapper bean for autowiring — a plain instance
    // is sufficient for reading assertion JSON here.
    final ObjectMapper json = new ObjectMapper();
    @Autowired
    UserRepository users;
    @Autowired
    PasswordEncoder passwordEncoder;
    @Autowired
    CapturingOtpSender otp;
    @PersistenceContext
    EntityManager em;

    // ---- login: dual-mode OTP ------------------------------------------------

    @Test
    void loginSendStepReturnsOtpSentAndNoTokens() throws Exception {
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"9876500201\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.otpSent").value(true))
                .andExpect(jsonPath("$.accessToken").doesNotExist())
                .andExpect(header().exists(RequestCorrelation.TRACE_ID_HEADER));
    }

    @Test
    void loginVerifyIssuesTokensAndAutoProvisionsBuyer() throws Exception {
        String mobile = "9876500202";
        sendOtp(mobile);

        MvcResult res = mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(body(mobile, otp.lastCode)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.refreshToken").isNotEmpty())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresIn").value(900))
                .andExpect(jsonPath("$.user.mobile").value(mobile))
                .andExpect(jsonPath("$.user.role").value("buyer"))
                .andExpect(jsonPath("$.user.mobileVerified").value(true))
                .andReturn();

        // the account now exists and is mobile-verified (L1 floor)
        User created = users.findByMobile(mobile).orElseThrow();
        org.assertj.core.api.Assertions.assertThat(created.isMobileVerified()).isTrue();
        org.assertj.core.api.Assertions.assertThat(created.getRole()).isEqualTo("buyer");
        // sanity: response actually carried a parseable token pair
        JsonNode b = json.readTree(res.getResponse().getContentAsString());
        // token responses omit otpSent entirely (AuthResponse is @JsonInclude(NON_NULL)).
        org.assertj.core.api.Assertions.assertThat(b.has("otpSent")).isFalse();
    }

    @Test
    void loginVerifyWithWrongOtpReturns401() throws Exception {
        String mobile = "9876500203";
        sendOtp(mobile);
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(body(mobile, "000000")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("unauthorized"))
                .andExpect(jsonPath("$.status").value(401));
    }

    @Test
    void loginVerifyWithNoActiveOtpReturns401() throws Exception {
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(body("9876500204", "123456")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("unauthorized"));
    }

    @Test
    void loginVerifyOverAttemptCapReturns429() throws Exception {
        String mobile = "9876500205";
        sendOtp(mobile);
        for (int i = 0; i < OtpService.MAX_ATTEMPTS; i++) {
            mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                    .content(body(mobile, "111111"))).andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(body(mobile, "111111")))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate_limited"));
    }

    // ---- login: send-rate limit (the contract's 429 on the send path) --------

    /**
     * A second code for the same number inside the cooldown is refused, with a truthful Retry-After.
     *
     * <p>This is the harassment control: without it, {@code POST /auth/login} is an unauthenticated
     * endpoint that rings any phone the caller names, as often as they like.
     */
    @Test
    void secondCodeInsideTheCooldownIs429WithRetryAfter() throws Exception {
        String mobile = "9876500701";
        sendOtp(mobile);

        MvcResult res = mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"" + mobile + "\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate_limited"))
                .andExpect(jsonPath("$.status").value(429))
                .andExpect(header().exists(HttpHeaders.RETRY_AFTER))
                .andReturn();

        int retryAfter = Integer.parseInt(res.getResponse().getHeader(HttpHeaders.RETRY_AFTER));
        org.assertj.core.api.Assertions.assertThat(retryAfter)
                .as("Retry-After must be a usable hint, never 0 or longer than the cooldown")
                .isBetween(1, (int) OtpService.SEND_COOLDOWN.toSeconds());
    }

    /**
     * The hourly budget stops a slow drip that the cooldown alone would allow.
     *
     * <p>Rows are backdated past the cooldown between sends — otherwise the cooldown, not the window,
     * would be what rejects sends 2..5 and this test would prove nothing about the window.
     */
    @Test
    void sendsBeyondTheHourlyBudgetAre429EvenWhenTheCooldownHasPassed() throws Exception {
        String mobile = "9876500702";
        for (int i = 0; i < OtpService.MAX_SENDS_PER_WINDOW; i++) {
            sendOtp(mobile);
            ageOutCooldown(mobile);
        }

        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"" + mobile + "\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate_limited"))
                .andExpect(header().exists(HttpHeaders.RETRY_AFTER));
    }

    /**
     * The budget is per number, so one attacker cannot lock everybody else out of logging in.
     *
     * <p>The regression this guards is a plausible "simplification": counting sends globally rather
     * than per mobile would pass the two tests above while turning the rate limiter into a
     * denial-of-service tool aimed at the whole platform.
     */
    @Test
    void exhaustingOneNumbersBudgetDoesNotBlockAnother() throws Exception {
        String victim = "9876500703";
        sendOtp(victim);
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"" + victim + "\"}"))
                .andExpect(status().isTooManyRequests());

        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"9876500704\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.otpSent").value(true));
    }

    /** Shift this number's existing codes back past the cooldown, leaving them inside the window. */
    private void ageOutCooldown(String mobile) {
        // why flush/clear around the raw UPDATE: the send wrote through JPA and may still be pending,
        // so without a flush the UPDATE matches nothing; without the clear, the next repository read
        // would be served the stale first-level-cache entity and never see the new created_at.
        em.flush();
        jdbc.update("update otp_codes set created_at = created_at - (?::text || ' seconds')::interval"
                        + " where mobile = ?",
                OtpService.SEND_COOLDOWN.toSeconds() + 1, mobile);
        em.clear();
    }

    // ---- login: request validation (422) ------------------------------------

    @Test
    void loginMissingMobileReturns422WithFields() throws Exception {
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("validation_failed"))
                .andExpect(jsonPath("$.status").value(422))
                .andExpect(jsonPath("$.fields[0].field").value("mobile"));
    }

    @Test
    void loginMalformedMobileReturns422() throws Exception {
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"123\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("mobile"));
    }

    // ---- staff login --------------------------------------------------------

    @Test
    void staffLoginWithGoodPasswordIssuesTokens() throws Exception {
        seedStaff("9876500301", "ops@punenest.in", "s3cret-pass", "rental");
        mvc.perform(post("/auth/staff-login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ops@punenest.in\",\"password\":\"s3cret-pass\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.user.role").value("staff"))
                .andExpect(jsonPath("$.user.team").value("rental"));
    }

    @Test
    void staffLoginWithBadPasswordReturns401() throws Exception {
        seedStaff("9876500302", "ops2@punenest.in", "s3cret-pass", "legal");
        mvc.perform(post("/auth/staff-login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ops2@punenest.in\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("unauthorized"));
    }

    @Test
    void staffLoginUnknownEmailReturns401() throws Exception {
        mvc.perform(post("/auth/staff-login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"nobody@punenest.in\",\"password\":\"whatever\"}"))
                .andExpect(status().isUnauthorized());
    }

    /**
     * The read path matches the write path's case rule.
     *
     * <p>{@code V70__users_live_email_unique.sql} indexes {@code lower(email)} and the uniqueness
     * checks on {@code addStaff}/{@code update} use {@code IgnoreCase}, so nobody else can ever hold
     * a case variant of this address — it can only be the same colleague. Resolving the login
     * case-sensitively therefore authenticated nobody and locked out the one person entitled to it.
     */
    @Test
    void staffLoginIsCaseInsensitiveBecauseUniquenessIs() throws Exception {
        seedStaff("9876500303", "A.Sharma@punenest.in", "s3cret-pass", "legal");
        mvc.perform(post("/auth/staff-login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"a.sharma@punenest.in\",\"password\":\"s3cret-pass\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty());
    }

    // ---- refresh: rotation + reuse-detection --------------------------------

    @Test
    void refreshRotatesTokensAndOldTokenReuseRevokesFamily() throws Exception {
        String mobile = "9876500401";
        sendOtp(mobile);
        JsonNode login = json.readTree(mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(body(mobile, otp.lastCode)))
                .andReturn().getResponse().getContentAsString());
        String refresh1 = login.get("refreshToken").asText();

        // first rotation succeeds
        JsonNode rotated = json.readTree(mvc.perform(post("/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + refresh1 + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.refreshToken").isNotEmpty())
                .andReturn().getResponse().getContentAsString());
        String refresh2 = rotated.get("refreshToken").asText();
        assertThat(refresh2).isNotEqualTo(refresh1);

        // replaying the now-rotated token is treated as theft ⇒ 401
        mvc.perform(post("/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + refresh1 + "\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("unauthorized"));

        // ...and the family goes with it. What differs between the fixed and unfixed code is not
        // anything the caller can see — both answer the same 401 — but whether `rotate`'s advice
        // marked the shared transaction rollback-only on its way out. Without `noRollbackFor` it
        // does, and every `revoke()` above is discarded at commit while the response is unchanged,
        // which is why the bug survived from ADR-008 until 2026-08-11 (D207).
        //
        // Three nearer-looking probes are all useless here, and each was written, run, and believed
        // for a moment before being tested against the reintroduced bug:
        // • re-presenting `refresh2` and expecting 401 — this test runs inside one transaction, so
        //   the revoked entities stay managed and answer "revoked" from the persistence context
        //   whether or not the write would ever have reached the database. Passes either way;
        // • `TestTransaction.isFlaggedForRollback()` — reports the test's end-of-run rollback
        //   preference, which is `true` unconditionally;
        // • `TransactionAspectSupport.currentTransactionStatus()` — the test transaction is managed
        //   by the TestContext framework, not the transaction aspect, so nothing is in scope.
        // The bound `EntityManagerHolder` is not marked either; the `ConnectionHolder` is. Settled
        // by reverting the annotation and reading both, which gave `false/true`.
        ConnectionHolder connection = (ConnectionHolder) TransactionSynchronizationManager
                .getResource(jdbc.getDataSource());
        assertThat(connection.isRollbackOnly())
                .as("reuse detection revoked the token family, and that write must survive the 401 "
                        + "it is thrown alongside — see tech-debt D207 and D90")
                .isFalse();
    }

    // ---- logout -------------------------------------------------------------

    @Test
    void logoutRevokesRefreshFamilyAndRequiresAuth() throws Exception {
        String mobile = "9876500501";
        sendOtp(mobile);
        JsonNode login = json.readTree(mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(body(mobile, otp.lastCode)))
                .andReturn().getResponse().getContentAsString());
        String access = login.get("accessToken").asText();
        String refresh = login.get("refreshToken").asText();

        // unauthenticated logout is rejected
        mvc.perform(post("/auth/logout")).andExpect(status().isUnauthorized());

        // authenticated logout succeeds
        mvc.perform(post("/auth/logout").header("Authorization", "Bearer " + access))
                .andExpect(status().isNoContent());

        // the refresh token can no longer be used
        mvc.perform(post("/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + refresh + "\"}"))
                .andExpect(status().isUnauthorized());
    }

    // ---- mock-provider parity ----------------------------------------------

    @Test
    void authResponseUserCarriesTheFieldsTheFrontendConsumes() throws Exception {
        String mobile = "9876500601";
        sendOtp(mobile);
        JsonNode user = json.readTree(mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(body(mobile, otp.lastCode)))
                .andReturn().getResponse().getContentAsString()).get("user");

        // the mock UI (lib/auth.js) reads name/mobile/role; the http provider maps the rest.
        org.assertj.core.api.Assertions.assertThat(user.has("id")).isTrue();
        // a freshly auto-provisioned buyer has no name yet, so NON_NULL omits it (UI treats absent as "unset").
        org.assertj.core.api.Assertions.assertThat(user.has("name")).isFalse();
        org.assertj.core.api.Assertions.assertThat(user.get("mobile").asText()).isEqualTo(mobile);
        org.assertj.core.api.Assertions.assertThat(user.get("role").asText()).isEqualTo("buyer");
    }

    // ---- helpers ------------------------------------------------------------

    private void sendOtp(String mobile) throws Exception {
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mobile\":\"" + mobile + "\"}")).andExpect(status().isOk());
    }

    private static String body(String mobile, String otp) {
        return "{\"mobile\":\"" + mobile + "\",\"otp\":\"" + otp + "\"}";
    }

    private void seedStaff(String mobile, String email, String rawPassword, String team) {
        User u = new User(mobile, "staff");
        u.setEmail(email);
        u.setPasswordHash(passwordEncoder.encode(rawPassword));
        u.setTeam(team);
        users.saveAndFlush(u);
    }

    /** Captures the last OTP so the send→verify round-trip is testable with zero external deps. */
    static class CapturingOtpSender implements OtpSender {
        volatile String lastCode;

        @Override
        public void send(String mobile, String code) {
            this.lastCode = code;
        }
    }

    @TestConfiguration
    static class Config {
        @Bean
        @Primary
        CapturingOtpSender capturingOtpSender() {
            return new CapturingOtpSender();
        }
    }
}
