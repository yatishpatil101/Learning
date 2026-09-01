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
    @Autowired
    DataSource dataSource;
    /* The cookie names are decided at runtime from `secure`, so they must be asked for rather than
       hardcoded — the suite runs on the unprefixed shape and production on the `__Host-` one. */
    @Autowired
    RefreshCookie cookies;
    /* Only the configured refresh TTL, and only so the hint's Max-Age can be checked against the
       number the operator set rather than against the sibling cookie that was built from the same
       field a line earlier. */
    @Autowired
    JwtProperties jwt;
    @PersistenceContext
    EntityManager em;

    /** Captured for {@link #removeAutoProvisionedBuyers()}, which cannot be injected into. */
    private static DataSource cleanupDataSource;

    @BeforeEach
    void captureDataSourceForCleanup() {
        cleanupDataSource = dataSource;
    }

    /**
     * Removes the buyer rows that a successful first sign-in leaves behind.
     *
     * <p>{@code UserService.provisionBuyer} is {@code REQUIRES_NEW} on purpose — it keeps a
     * concurrent first sign-in's {@code UNIQUE(mobile)} violation in a transaction that can roll
     * back alone. The cost is that its insert commits, so the class-level {@code @Transactional}
     * rollback never reaches it and this database accumulates a row per verified mobile. Four of
     * the tests below drive a verify to success, and without this they left four permanent rows in
     * {@code draazy_test} — which is meant to be empty between runs.
     *
     * <p>This must be {@code @AfterAll}, not {@code @AfterEach}. A per-test cleanup has to commit
     * (a plain {@code jdbc.update} would join the test transaction and be rolled back with
     * everything else, cleaning nothing), and a committing delete runs on a second connection —
     * which then blocks forever on the row locks the still-open test transaction holds. Postgres
     * sets no lock timeout, so the symptom is a silent hang, not an error. Running once the class
     * is over means every test transaction has already closed and nothing is held.
     *
     * <p>Keyed on this class's own mobile range rather than an explicit list so a test added later
     * is covered without anyone remembering to.
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
                // The refresh token is *not* in the body — asserted as an absence, because the whole
                // point of moving it to an HttpOnly cookie is that no client can read it, and a
                // regression that put it back would otherwise be invisible.
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresIn").value(900))
                .andExpect(jsonPath("$.user.mobile").value(mobile))
                .andExpect(jsonPath("$.user.role").value("buyer"))
                .andExpect(jsonPath("$.user.mobileVerified").value(true))
                .andReturn();

        // ...and it did arrive, with the attributes that make hiding it worth anything. HttpOnly is
        // the one under test. The path is deliberately `/` rather than the narrower `/api/auth` it
        // once was: path scoping only ever defended against our own code logging or forwarding a
        // request (nothing in this backend logs cookies), while `__Host-` — which mandates `Path=/`
        // — defends against another host under the registrable domain planting a twin. Trading a
        // self-imposed hygiene rule for a browser-enforced one is the better half of that deal.
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
     * The read path matches the write path's case rule.
     *
     * <p>{@code V02__DDL_identity_access.sql} indexes {@code lower(email)} in
     * {@code uq_users_live_email_ci} (added in the old V70) and the uniqueness
     * checks on {@code addStaff}/{@code update} use {@code IgnoreCase}, so nobody else can ever hold
     * a case variant of this address — it can only be the same colleague. Resolving the login
     * case-sensitively therefore authenticated nobody and locked out the one person entitled to it.
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

        // Replaying the now-rotated token is treated as theft ⇒ 401. Immediate, so the grace window
        // would forgive it; the suite shuts that window (src/test/resources/application.properties)
        // precisely so this assertion is about reuse-detection and not about the clock.
        mvc.perform(post("/auth/refresh").cookie(refresh1))
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
        MockHttpServletResponse login = mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(body(mobile, otp.lastCode)))
                .andReturn().getResponse();
        String access = json.readTree(login.getContentAsString()).get("accessToken").asText();
        Cookie refresh = login.getCookie(cookies.name());
        assertThat(refresh).isNotNull();

        // unauthenticated logout is rejected
        mvc.perform(post("/auth/logout")).andExpect(status().isUnauthorized());

        // authenticated logout succeeds, and tells the browser to drop the cookie. Revoking the
        // family server-side is what ends the session; expiring the cookie is what stops a shared
        // machine's next visitor from carrying a dead credential around to be replayed.
        Cookie cleared = mvc.perform(post("/auth/logout").header("Authorization", "Bearer " + access))
                .andExpect(status().isNoContent())
                .andReturn().getResponse().getCookie(cookies.name());
        assertThat(cleared).isNotNull();
        assertThat(cleared.getMaxAge()).isZero();

        // the refresh token can no longer be used
        mvc.perform(post("/auth/refresh").cookie(refresh))
                .andExpect(status().isUnauthorized());
    }

    // ---- session hint -------------------------------------------------------

    /**
     * The readable marker that lets a cold boot tell "signed out" from "web storage was cleared".
     *
     * <p>Everything asserted here is load-bearing for the Safari case it exists for, and each would
     * fail silently: not {@code HttpOnly} or the client cannot read it at all; {@code Path=/} or
     * {@code document.cookie} hides it from every page outside {@code /api/auth}; and the same
     * {@code Max-Age} as the refresh token or the pair drifts apart — a hint outliving its token
     * sends every boot into a refresh that can only 401, and a token outliving its hint puts the
     * seven-day cliff back exactly where it was.
     *
     * <p>Its value is asserted to carry no identity, which is the reason making it readable is safe.
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
        /* The line above compares the pair to each other, which is the property that matters but is
           also satisfied by both being wrong in the same direction — both zero would read as "they
           agree" while clearing the session on arrival. Both are built from `jwt.refreshTtl()` in
           the same method, so the sibling is not an independent witness; the configured duration
           is. Asserted as a duration rather than a literal 2592000 so that changing the TTL in
           `application.properties` moves this test with it instead of breaking it. */
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
     * Logout clears the hint too.
     *
     * <p>Without this the marker survives the sign-out that revoked its token, and the next cold
     * boot spends a refresh that can only 401 — a clean sign-out turned into a request shaped
     * exactly like reuse-detection tripping.
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
     * An unremembered session gets an unremembered hint.
     *
     * <p>A persistent marker beside a session cookie would claim, after a browser restart, that a
     * session exists whose token the browser has already dropped — every cold boot spending a
     * doomed refresh, and the "remember this device" checkbox quietly meaning nothing.
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
     * No cookie is an absent session, not a malformed request.
     *
     * <p>The distinction matters to the client: a 401 is the one answer {@code services/http.js}
     * already knows how to act on — clear the cache, route to sign-in. A 422 would be an argument
     * about a field the caller cannot see or set, since the browser owns the cookie jar, and the
     * recovery path would never run.
     */
    @Test
    void refreshWithoutTheCookieIsUnauthorizedNotUnprocessable() throws Exception {
        mvc.perform(post("/auth/refresh"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("unauthorized"));
    }

    /**
     * A refused refresh clears the hint, so a dead session converges instead of retrying forever.
     *
     * <p>The hint outliving its token is not hypothetical: a family burned by reuse-detection, a
     * sign-out on another device, or plain expiry all revoke the token while the marker keeps its
     * original 30-day life. Nothing else can tell the client to stop — that is the whole point of a
     * marker the server owns — so every cold boot for the rest of the month reads the hint, spends a
     * refresh and gets a 401. This is the only response in a position to say otherwise.
     *
     * <p>Asserted on the reuse-detection path rather than the missing-cookie one because it is the
     * case that arrives holding a stale hint. The missing-cookie path is a separate call site and is
     * covered separately below, since "the same line of code" is exactly the assumption that lets
     * one of two branches rot.
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
     * The other call site: an absent cookie clears the hint too, and that is the common case.
     *
     * <p>An <em>expired</em> refresh cookie is not in the jar at all, so a client whose 30-day token
     * simply ran out arrives here with a marker and nothing else. If only the reuse-detection branch
     * cleared, exactly the users with no session left would keep the marker that makes them ask
     * again — the forever-401 loop, aimed at the population most likely to hit it.
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
     * A cross-site caller cannot use our 401 to delete the visitor's marker.
     *
     * <p>{@code SameSite=Lax} decides whether a cookie is <em>sent</em>, not whether one may be
     * <em>set</em>. So any page anywhere can POST here, watch Lax correctly withhold the refresh
     * cookie, and — without the gate — have the resulting 401 expire the victim's marker in their
     * own jar. The ceiling is low (they must sign in again; the refresh cookie itself survives) but
     * it is an unauthenticated write primitive into our cookie jar, handed out for free, and it
     * silently disables the ITP recovery for anyone an attacker can get to load a page.
     *
     * <p>Worth pinning explicitly because the gate is invisible to every other test in the suite:
     * MockMvc sends no {@code Sec-Fetch-Site} header, which is the "treat as ours" branch, so the
     * whole condition could be deleted or inverted and the other sixty-odd auth tests would stay
     * green.
     *
     * <p>The status is a 403 rather than the 401 this originally asserted, and the change is the
     * point rather than an inconvenience: {@link RefreshOriginGate} now refuses a cross-site caller
     * before the handler reads the cookie at all, so the request never reaches {@code clearHint}.
     * The claim being made here is unchanged — the marker survives — but it is now defended twice,
     * by the gate first and by {@code clearHint}'s own condition behind it. Both are kept: the gate
     * is about who may <em>rotate</em>, {@code clearHint}'s condition is about who may <em>clear</em>,
     * and collapsing them would make one endpoint's behaviour depend on the other's reasoning.
     */
    @Test
    void aCrossSiteCallerCannotForceTheHintToBeCleared() throws Exception {
        Cookie hint = mvc.perform(post("/auth/refresh").header("Sec-Fetch-Site", "cross-site"))
                .andExpect(status().isForbidden())
                .andReturn().getResponse().getCookie(cookies.hintName());

        assertThat(hint).as("a cross-site POST must not be able to expire our marker").isNull();
    }

    /**
     * A same-site sibling cannot spend the visitor's refresh token on their behalf.
     *
     * <p>This is the assertion the {@link RefreshOriginGate} exists for, and the one the unit test
     * next door cannot make: that the token is <em>still usable afterwards</em>. The attack was never
     * about reading the response — CORS censors that — it was that the rotation happened anyway, so
     * the visitor's cookie went stale and their next refresh, minutes later and well outside the
     * grace window, tripped reuse-detection and burned every session they had. A gate that returned
     * 403 but rotated first would pass every other assertion in this file and change nothing.
     *
     * <p>{@code same-site} rather than {@code cross-site} deliberately: cross-site never had the
     * cookie to spend, so it proves nothing. Same-site is the one an attacker actually gets, in the
     * one topology {@code SameSite=Lax} works in, and it is the value {@code clearHint}'s older gate
     * lets through.
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
