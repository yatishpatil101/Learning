package com.draazy.api.identity.auth;

import com.draazy.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.draazy.api.common.web.RequestCorrelation;
import com.draazy.api.provider.OtpSender;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.JwtProperties;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.servlet.http.Cookie;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * The four auth endpoints through the real filter chain, with a capturing {@link OtpSender} so the
 * send→verify round trip runs without an external dependency.
 */
class AuthEndpointsTest extends AbstractApiTest {

    // Boot 4 test contexts expose no ObjectMapper bean; a plain instance reads assertion JSON.
    final ObjectMapper json = new ObjectMapper();
    @Autowired
    UserRepository users;
    @Autowired
    PasswordEncoder passwordEncoder;
    @Autowired
    CapturingOtpSender otp;
    @Autowired
    DataSource dataSource;
    /* Cookie names are decided at runtime from `secure`: the suite runs unprefixed, prod `__Host-`. */
    @Autowired
    RefreshCookie cookies;
    /* So the hint's Max-Age is checked against the operator's number, not the sibling cookie built
       from the same field a line earlier. */
    @Autowired
    JwtProperties jwt;
    /* The cap is configurable, so hardcoding the default would make this a second silent opinion. */
    @Autowired
    OtpService otpService;
    @PersistenceContext
    EntityManager em;

    /** Captured for {@link #removeAutoProvisionedBuyers()}, which cannot be injected into. */
    private static DataSource cleanupDataSource;

    @BeforeEach
    void captureDataSourceForCleanup() {
        cleanupDataSource = dataSource;
    }

    /**
     * {@code provisionBuyer} is {@code REQUIRES_NEW}, so its insert commits past the class rollback.
     * {@code @AfterAll} because a committing delete on a second connection would block on row locks.
     */
    @AfterAll
    static void removeAutoProvisionedBuyers() {
        if (cleanupDataSource == null) {
            return;
        }
        new JdbcTemplate(cleanupDataSource).update("delete from users where mobile like '987650%'");
    }

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
                // Asserted as an absence: the point of the HttpOnly cookie is that no client can
                // read it, and a regression putting it back would otherwise be invisible.
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresIn").value(900))
                .andExpect(jsonPath("$.user.mobile").value(mobile))
                .andExpect(jsonPath("$.user.role").value("buyer"))
                .andExpect(jsonPath("$.user.mobileVerified").value(true))
                .andReturn();

        // Path is `/` rather than `/api/auth` because `__Host-` mandates it, and that prefix is what
        // stops another host under the registrable domain planting a twin.
        Cookie refresh = res.getResponse().getCookie(cookies.name());
        assertThat(refresh).isNotNull();
        assertThat(refresh.getValue()).isNotBlank();
        assertThat(refresh.isHttpOnly()).isTrue();
        assertThat(refresh.getPath()).isEqualTo("/");

        // the account now exists and is mobile-verified (L1 floor)
        User created = users.findByMobile(mobile).orElseThrow();
        org.assertj.core.api.Assertions.assertThat(created.isMobileVerified()).isTrue();
        org.assertj.core.api.Assertions.assertThat(created.getRole()).isEqualTo("buyer");
        // sanity: response actually carried a parseable body
        JsonNode b = json.readTree(res.getResponse().getContentAsString());
        // token responses omit otpSent entirely (AuthResponse is @JsonInclude(NON_NULL)).
        org.assertj.core.api.Assertions.assertThat(b.has("otpSent")).isFalse();
        // ...and the send step's resend cooldown with it: verifying has no cooldown of its own, so a
        // client handed one here would start a countdown against nothing.
        org.assertj.core.api.Assertions.assertThat(b.has("resendAfterSeconds")).isFalse();
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
        for (int i = 0; i < otpService.maxVerifyAttempts(); i++) {
            mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                    .content(body(mobile, "111111"))).andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(body(mobile, "111111")))
                .andExpect(status().isTooManyRequests())
                // Not the generic `rate_limited`: the per-IP write filter answers 429 with that
                // code, and a client told to wait on a burnt code waits forever.
                .andExpect(jsonPath("$.error").value("otp_attempts_exhausted"))
                .andExpect(jsonPath("$.attemptsRemaining").doesNotExist());
    }

    /**
     * The count is derived after the attempt is recorded, so the last wrong guess reports zero.
     * An off-by-one either promises a refused guess or burns a code while the screen says otherwise.
     */
    @Test
    void wrongOtpCountsDownToZeroAndThenStopsReporting() throws Exception {
        String mobile = "9876500207";
        sendOtp(mobile);
        int cap = otpService.maxVerifyAttempts();

        for (int spent = 1; spent <= cap; spent++) {
            mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                            .content(body(mobile, "111111")))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.attemptsRemaining").value(cap - spent));
        }

        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(body(mobile, "111111")))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.attemptsRemaining").doesNotExist());
    }

    /**
     * The client branches on the field's presence to pick "try again" over "ask for a new code", so
     * a count here sends the user back to a keypad for a code that does not exist.
     */
    @Test
    void noActiveOtpReportsNoAttemptCount() throws Exception {
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(body("9876500208", "123456")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.attemptsRemaining").doesNotExist())
                .andExpect(jsonPath("$.error").value("unauthorized"));
    }

    /**
     * Terminal, so sharing {@code unauthorized} with "that code is gone" would loop the client
     * through fresh codes until the hourly send budget was spent — a lockout made by the envelope.
     */
    @Test
    void anArchivedAccountIsRefusedUnderItsOwnCode() throws Exception {
        String mobile = "9876500209";
        User closed = new User(mobile, "buyer");
        closed.archive("closed for this test");
        users.saveAndFlush(closed);
        sendOtp(mobile);

        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(body(mobile, otp.lastCode)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("account_archived"))
                .andExpect(jsonPath("$.attemptsRemaining").doesNotExist());
    }

    // ---- login: closed signups ----------------------------------------------

    /**
     * {@code POST /auth/login} provisions on first verified sign-in, so a route guard alone leaves
     * the window open. Both halves in one test: refusing existing members would be a worse outage.
     */
    @Test
    void closedSignupsRefuseANewMobileButStillAdmitAnExistingOne() throws Exception {
        closeSignups();

        String stranger = "9876500250";
        sendOtp(stranger);
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(body(stranger, otp.lastCode)))
                .andExpect(status().isForbidden())
                // Its own code: a plain 403 is answered by signing in as somebody permitted.
                .andExpect(jsonPath("$.error").value("signups_closed"));
        assertThat(users.findByMobile(stranger)).isEmpty();

        String member = "9876500251";
        users.saveAndFlush(new User(member, "buyer"));
        sendOtp(member);
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(body(member, otp.lastCode)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty());
    }

    /**
     * The rollback-only assertion is the load-bearing one: inside a shared transaction the replay
     * answers 401 either way, so only asking whether the transaction was poisoned can go red.
     */
    @Test
    void closedSignupsStillBurnTheVerifiedCode() throws Exception {
        closeSignups();
        String stranger = "9876500252";
        sendOtp(stranger);
        String code = otp.lastCode;

        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(body(stranger, code))).andExpect(status().isForbidden());
        assertThat(poisoned())
                .as("the refusal must not poison the transaction that burnt the code")
                .isFalse();

        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(body(stranger, code)))
                .andExpect(status().isUnauthorized());
    }

    /**
     * The {@code ConnectionHolder} is the only one that reports this: {@code TransactionAspectSupport}
     * throws here and the {@code EntityManagerHolder} is never marked, both silently un-failable.
     */
    private boolean poisoned() {
        ConnectionHolder holder = (ConnectionHolder) TransactionSynchronizationManager
                .getResource(jdbc.getDataSource());
        return holder != null && holder.isRollbackOnly();
    }

    /**
     * {@code clear()} because a JPA-cached settings row would hide the raw UPDATE from the next read.
     * The row count is asserted so an unseeded {@code flags} key cannot make this a silent no-op.
     */
    private void setFlag(String name, boolean value) {
        int flipped = jdbc.update("update settings set value = "
                + "jsonb_set(value, ?::text[], ?::jsonb) where key = 'flags'",
                "{" + name + "}", String.valueOf(value));
        assertThat(flipped).isEqualTo(1);
        em.flush();
        em.clear();
    }

    private void closeSignups() {
        setFlag("signupsEnabled", false);
    }

    // ---- login: send-rate limit (the contract's 429 on the send path) --------

    /**
     * The harassment control: without it {@code POST /auth/login} is an unauthenticated endpoint
     * that rings any phone the caller names, as often as they like.
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
                .isBetween(1, (int) OtpSendBudget.SEND_COOLDOWN.toSeconds());
    }

    /**
     * Rows are backdated past the cooldown between sends, or the cooldown rather than the window
     * would be what rejects sends 2..5 and this would prove nothing.
     */
    @Test
    void sendsBeyondTheHourlyBudgetAre429EvenWhenTheCooldownHasPassed() throws Exception {
        String mobile = "9876500702";
        for (int i = 0; i < OtpSendBudget.MAX_SENDS_PER_WINDOW; i++) {
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
     * Counting sends globally rather than per mobile passes the two tests above while turning the
     * rate limiter into a denial-of-service tool aimed at the whole platform.
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
        // Without the flush the pending JPA write means the UPDATE matches nothing; without the
        // clear the next repository read is served a stale entity carrying the old created_at.
        em.flush();
        jdbc.update("update otp_codes set created_at = created_at - (?::text || ' seconds')::interval"
                        + " where mobile = ?",
                OtpSendBudget.SEND_COOLDOWN.toSeconds() + 1, mobile);
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
        seedStaff("9876500301", "ops@draazy.in", "s3cret-pass", "rental");
        mvc.perform(post("/auth/staff-login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ops@draazy.in\",\"password\":\"s3cret-pass\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.user.role").value("staff"))
                .andExpect(jsonPath("$.user.team").value("rental"));
    }

    @Test
    void staffLoginWithBadPasswordReturns401() throws Exception {
        seedStaff("9876500302", "ops2@draazy.in", "s3cret-pass", "legal");
        mvc.perform(post("/auth/staff-login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ops2@draazy.in\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("unauthorized"));
    }

    @Test
    void staffLoginUnknownEmailReturns401() throws Exception {
        mvc.perform(post("/auth/staff-login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"nobody@draazy.in\",\"password\":\"whatever\"}"))
                .andExpect(status().isUnauthorized());
    }

    /**
     * The admin exemption is what makes the gate safe: the flag lives behind the admin console, so
     * refusing admins too would let one toggle eat the only route back to itself.
     */
    @Test
    void closedStaffLoginRefusesStaffButStillAdmitsAnAdmin() throws Exception {
        seedStaff("9876500304", "ops3@draazy.in", "s3cret-pass", "rental");
        seedAdmin("9876500305", "boss@draazy.in", "s3cret-pass");
        setFlag("staffLoginEnabled", false);

        mvc.perform(post("/auth/staff-login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ops3@draazy.in\",\"password\":\"s3cret-pass\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("forbidden"));

        mvc.perform(post("/auth/staff-login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"boss@draazy.in\",\"password\":\"s3cret-pass\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty());
    }

    /**
     * The gate sits behind the credential check: a 403 here would sort arbitrary addresses into
     * staff and not-staff for an unauthenticated caller — the enumeration oracle the order avoids.
     */
    @Test
    void closedStaffLoginStillAnswers401ForABadPassword() throws Exception {
        seedStaff("9876500306", "ops4@draazy.in", "s3cret-pass", "legal");
        setFlag("staffLoginEnabled", false);

        mvc.perform(post("/auth/staff-login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ops4@draazy.in\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("unauthorized"));
    }

    /**
     * Uniqueness is on {@code lower(email)}, so a case variant can only be the same colleague and a
     * case-sensitive login would authenticate nobody while locking out the person entitled to it.
     */
    @Test
    void staffLoginIsCaseInsensitiveBecauseUniquenessIs() throws Exception {
        seedStaff("9876500303", "A.Sharma@draazy.in", "s3cret-pass", "legal");
        mvc.perform(post("/auth/staff-login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"a.sharma@draazy.in\",\"password\":\"s3cret-pass\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty());
    }

    // ---- refresh: rotation + reuse-detection --------------------------------

    @Test
    void refreshRotatesTokensAndOldTokenReuseRevokesFamily() throws Exception {
        String mobile = "9876500401";
        sendOtp(mobile);
        Cookie refresh1 = mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(body(mobile, otp.lastCode)))
                .andReturn().getResponse().getCookie(cookies.name());
        assertThat(refresh1).isNotNull();

        // first rotation succeeds
        Cookie refresh2 = mvc.perform(post("/auth/refresh").cookie(refresh1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andReturn().getResponse().getCookie(cookies.name());
        assertThat(refresh2).isNotNull();
        assertThat(refresh2.getValue()).isNotEqualTo(refresh1.getValue());

        // Replay is theft ⇒ 401. The suite shuts the grace window (test application.properties) so
        // this assertion is about reuse-detection and not about the clock.
        mvc.perform(post("/auth/refresh").cookie(refresh1))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("unauthorized"));

        // The caller sees the same 401 either way; only `rotate`'s advice marking the shared
        // transaction rollback-only differs, and the ConnectionHolder is the one holder that shows it.
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
        MockHttpServletResponse login = mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(body(mobile, otp.lastCode)))
                .andReturn().getResponse();
        String access = json.readTree(login.getContentAsString()).get("accessToken").asText();
        Cookie refresh = login.getCookie(cookies.name());
        assertThat(refresh).isNotNull();

        // unauthenticated logout is rejected
        mvc.perform(post("/auth/logout")).andExpect(status().isUnauthorized());

        // Revoking the family ends the session; expiring the cookie stops a shared machine's next
        // visitor from carrying a dead credential around to be replayed.
        Cookie cleared = mvc.perform(post("/auth/logout").header("Authorization", "Bearer " + access))
                .andExpect(status().isNoContent())
                .andReturn().getResponse().getCookie(cookies.name());
        assertThat(cleared).isNotNull();
        assertThat(cleared.getMaxAge()).isZero();

        // the refresh token is dead too
        mvc.perform(post("/auth/refresh").cookie(refresh))
                .andExpect(status().isUnauthorized());
    }

    // ---- session hint -------------------------------------------------------

    /**
     * Each attribute fails silently if wrong: not HttpOnly or the boot path cannot read the hint,
     * {@code Path=/} or it is invisible off {@code /api/auth}, matching Max-Age or the pair drifts.
     */
    @Test
    void loginIssuesAReadableSessionHintBesideTheRefreshCookie() throws Exception {
        String mobile = "9876500601";
        sendOtp(mobile);
        MockHttpServletResponse login = mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(body(mobile, otp.lastCode)))
                .andExpect(status().isOk())
                .andReturn().getResponse();

        Cookie hint = login.getCookie(cookies.hintName());
        assertThat(hint).isNotNull();
        assertThat(hint.isHttpOnly())
                .as("the hint is only useful if the boot path can read it from document.cookie")
                .isFalse();
        assertThat(hint.getPath())
                .as("cookie reads are path-scoped, and the boot check runs on whatever page the "
                        + "visitor landed on")
                .isEqualTo("/");
        assertThat(hint.getMaxAge())
                .as("hint and refresh token must expire together")
                .isEqualTo(login.getCookie(cookies.name()).getMaxAge());
        /* The sibling is not an independent witness — both are built from `jwt.refreshTtl()` in the
           same method, so both being zero would read as agreement while clearing the session. */
        assertThat(hint.getMaxAge())
                .as("the hint lives for the configured refresh TTL — the whole point of it being a "
                        + "server-set cookie is that Safari's seven-day cap does not apply")
                .isEqualTo((int) jwt.refreshTtl().toSeconds());
        assertThat(hint.getValue())
                .as("the hint answers 'is there a session, and was it meant to last' and must "
                        + "disclose nothing else")
                .doesNotContain(mobile);
        assertThat(hint.getValue())
                .as("the client reads this to restate `remember` on rotation; after an ITP wipe it "
                        + "is the only surviving record of the choice, and a wrong value trades a "
                        + "30-day cookie for a session one during the very refresh that rescued it")
                .isEqualTo("1");
    }

    /**
     * Without this the marker survives the sign-out that revoked its token, and the next cold boot
     * spends a refresh that can only 401 — a clean sign-out shaped exactly like reuse-detection.
     */
    @Test
    void logoutClearsTheSessionHint() throws Exception {
        String mobile = "9876500602";
        sendOtp(mobile);
        String access = json.readTree(mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(body(mobile, otp.lastCode)))
                .andReturn().getResponse().getContentAsString()).get("accessToken").asText();

        Cookie hint = mvc.perform(post("/auth/logout").header("Authorization", "Bearer " + access))
                .andExpect(status().isNoContent())
                .andReturn().getResponse().getCookie(cookies.hintName());
        assertThat(hint).isNotNull();
        assertThat(hint.getMaxAge()).isZero();
        assertThat(hint.getPath())
                .as("a browser only replaces a cookie when name and path match, so a clear built "
                        + "with a different path leaves the original in the jar")
                .isEqualTo("/");
    }

    /**
     * A persistent marker beside a session cookie would claim after a browser restart that a session
     * exists whose token was already dropped, making "remember this device" quietly mean nothing.
     */
    @Test
    void anUnrememberedSessionGetsASessionScopedHint() throws Exception {
        String mobile = "9876500603";
        sendOtp(mobile);
        MockHttpServletResponse login = mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"" + mobile + "\",\"otp\":\"" + otp.lastCode
                                + "\",\"remember\":false}"))
                .andExpect(status().isOk())
                .andReturn().getResponse();

        assertThat(login.getCookie(cookies.hintName()).getMaxAge())
                .as("-1 is the servlet contract for 'no Max-Age' — a cookie that dies with the browser")
                .isEqualTo(-1);
        assertThat(login.getCookie(cookies.hintName()).getValue())
                .as("the value carries the choice as well as the lifetime, so a rotation cannot "
                        + "promote a session the user declined to have remembered")
                .isEqualTo("0");
    }

    /**
     * A 401 is the answer {@code services/http.js} acts on; a 422 would argue about a field the
     * caller cannot set, since the browser owns the cookie jar, and the recovery path never runs.
     */
    @Test
    void refreshWithoutTheCookieIsUnauthorizedNotUnprocessable() throws Exception {
        mvc.perform(post("/auth/refresh"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("unauthorized"));
    }

    /**
     * Revocation leaves the marker with its original 30-day life, so only this response can tell the
     * client to stop. Pinned on the reuse path and below on the missing-cookie one: two call sites.
     */
    @Test
    void aRefusedRefreshClearsTheSessionHint() throws Exception {
        String mobile = "9876500604";
        sendOtp(mobile);
        Cookie refresh = mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(body(mobile, otp.lastCode)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie(cookies.name());

        // Spend it once, then present the spent token: reuse-detection burns the family.
        mvc.perform(post("/auth/refresh").cookie(refresh)).andExpect(status().isOk());
        Cookie hint = mvc.perform(post("/auth/refresh").cookie(refresh))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getCookie(cookies.hintName());

        assertThat(hint)
                .as("a 401 that leaves the hint in the jar buys a doomed refresh on every cold boot "
                        + "until the marker's own 30 days run out")
                .isNotNull();
        assertThat(hint.getMaxAge()).isZero();
        assertThat(hint.getPath()).isEqualTo("/");
    }

    /**
     * An expired refresh cookie is not in the jar at all, so clearing only on the reuse branch would
     * strand exactly the users with no session left in the forever-401 loop.
     */
    @Test
    void refreshWithNoCookieAtAllAlsoClearsTheHint() throws Exception {
        Cookie hint = mvc.perform(post("/auth/refresh"))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getCookie(cookies.hintName());

        assertThat(hint).isNotNull();
        assertThat(hint.getMaxAge()).isZero();
    }

    /**
     * The gate is invisible to every other test — MockMvc sends no {@code Sec-Fetch-Site} header, the
     * "treat as ours" branch. See {@code docs/flows/consumer/auth.md} §5 for the attack it refuses.
     */
    @Test
    void aCrossSiteCallerCannotForceTheHintToBeCleared() throws Exception {
        Cookie hint = mvc.perform(post("/auth/refresh").header("Sec-Fetch-Site", "cross-site"))
                .andExpect(status().isForbidden())
                .andReturn().getResponse().getCookie(cookies.hintName());

        assertThat(hint).as("a cross-site POST must not be able to expire our marker").isNull();
    }

    /**
     * The load-bearing half is that the token is still usable afterwards: a gate that answered 403
     * but rotated first would pass everything else here. See {@code docs/flows/consumer/auth.md} §5.
     */
    @Test
    void aSameSiteSiblingCannotSpendTheVisitorsRefreshToken() throws Exception {
        String mobile = "9876500801";
        sendOtp(mobile);
        Cookie refresh = mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(body(mobile, otp.lastCode)))
                .andReturn().getResponse().getCookie(cookies.name());
        assertThat(refresh).isNotNull();

        mvc.perform(post("/auth/refresh").cookie(refresh)
                        .header("Sec-Fetch-Site", "same-site")
                        .header("Origin", "https://status.draazy.in"))
                .andExpect(status().isForbidden());

        mvc.perform(post("/auth/refresh").cookie(refresh))
                .andExpect(status().isOk());
    }

    /** ...while our own page, which says so, still gets the clear it needs to stop asking. */
    @Test
    void ourOwnPageStillGetsTheClear() throws Exception {
        Cookie hint = mvc.perform(post("/auth/refresh").header("Sec-Fetch-Site", "same-origin"))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getCookie(cookies.hintName());

        assertThat(hint).isNotNull();
        assertThat(hint.getMaxAge()).isZero();
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

    private void seedAdmin(String mobile, String email, String rawPassword) {
        User u = new User(mobile, "admin");
        u.setEmail(email);
        u.setPasswordHash(passwordEncoder.encode(rawPassword));
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
