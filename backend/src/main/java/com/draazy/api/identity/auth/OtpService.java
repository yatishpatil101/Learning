package com.draazy.api.identity.auth;

import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.error.OtpIncorrectException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.provider.OtpSender;
import com.draazy.api.security.LocalProfileGuard;
import jakarta.annotation.PostConstruct;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The mobile-OTP primitive behind passwordless login (ADR-008, L1): 6 digits, stored SHA-256 hashed,
 * single-use, 5-minute TTL, delivered through the {@link OtpSender} seam. docs/flows/consumer/auth.md
 */
@Service
public class OtpService {

    /** Short enough to limit exposure of a delivered code, long enough for real SMS latency. */
    static final Duration TTL = Duration.ofMinutes(5);

    /**
     * Online-guess ceiling per code before it is burned. Chosen for the honest typist rather than the
     * attacker — three of a 10^6 space is far below where guessing is a threat.
     */
    static final int DEFAULT_MAX_VERIFY_ATTEMPTS = 3;

    private static final SecureRandom RANDOM = new SecureRandom();

    private final OtpCodeRepository repository;
    private final OtpSender sender;
    /** Whether another code may be sent at all — see {@link OtpSendBudget} for all three limits. */
    private final OtpSendBudget budget;

    /**
     * When non-blank, the fixed code every {@link #sendCode} issues, so a browser suite can type it
     * rather than scrape a shared log. Guarded three ways — see docs/flows/consumer/auth.md.
     */
    private final String fixedCode;

    /**
     * The one deployment profile allowed to carry a predictable login code. An alias, not a literal,
     * so a profile rename cannot silently disarm the guards below.
     */
    private static final String SANDBOX_PROFILE = LocalProfileGuard.SANDBOX_PROFILE;

    /**
     * Sandbox's own predictable login code, kept a separate key from {@link #fixedCode} so no
     * variable meaningful in prod can set it. Cost and blast radius: docs/flows/consumer/auth.md
     */
    private final String sandboxCode;

    /** Consulted only by the two boot guards below, to read the active profiles. */
    private final Environment environment;

    /**
     * Wrong guesses allowed against one code before it is burned. Configurable per environment; see
     * {@link #DEFAULT_MAX_VERIFY_ATTEMPTS} and {@link #rejectUnusableAttemptCap}.
     */
    private final int maxVerifyAttempts;

    public OtpService(OtpCodeRepository repository, OtpSender sender, OtpSendBudget budget,
            Environment environment,
            @Value("${draazy.otp.fixed-code:}") String fixedCode,
            @Value("${draazy.otp.sandbox-code:}") String sandboxCode,
            @Value("${draazy.otp.max-verify-attempts:" + DEFAULT_MAX_VERIFY_ATTEMPTS + "}")
                    int maxVerifyAttempts) {
        this.repository = repository;
        this.sender = sender;
        this.budget = budget;
        this.environment = environment;
        this.fixedCode = fixedCode == null ? "" : fixedCode.trim();
        this.sandboxCode = sandboxCode == null ? "" : sandboxCode.trim();
        this.maxVerifyAttempts = maxVerifyAttempts;
    }

    /**
     * The configured cap, package-private for the tests that loop to it. Nothing in production reads
     * it — {@code verifyCode} derives the count it reports itself.
     */
    int maxVerifyAttempts() {
        return maxVerifyAttempts;
    }

    /**
     * How long before another code to the same number is allowed, in seconds. Published rather than
     * hardcoded client-side, because the gap is per-environment.
     */
    public int resendCooldownSeconds() {
        return budget.sendCooldownSeconds();
    }

    /**
     * Kill the boot on an attempt cap that cannot work: below 1 is an outage dressed as a rate limit,
     * above 20 stops being a brute-force defence. Both are typos a properties file makes easy.
     */
    @PostConstruct
    void rejectUnusableAttemptCap() {
        if (maxVerifyAttempts < 1 || maxVerifyAttempts > 20) {
            throw new IllegalStateException(
                    "draazy.otp.max-verify-attempts is " + maxVerifyAttempts
                            + ", which must be between 1 and 20. Below 1 every code is burned on its "
                            + "first use and nobody can sign in; above 20 the per-code guess ceiling "
                            + "stops being a brute-force defence.");
        }
    }

    /**
     * Kill the boot if a deployment is carrying a predictable login code. Keyed on a deployment
     * profile being active, so a mistyped profile lands on the safe side.
     */
    @PostConstruct
    void rejectFixedCodeInProduction() {
        String profile = LocalProfileGuard.activeDeploymentProfile(environment);
        if (!fixedCode.isEmpty() && profile != null) {
            throw new IllegalStateException(
                    "draazy.otp.fixed-code is set while the '" + profile + "' profile is active. "
                            + "This makes every login code predictable. Unset it (check E2E_OTP_CODE "
                            + "and DRAAZY_OTP_FIXED_CODE in the process environment, not only the "
                            + "properties files) or drop the '" + profile + "' profile.");
        }
    }

    /**
     * Kill the boot if sandbox's login code has escaped sandbox. Phrased as "sandbox and nothing
     * else", so a superset activation such as {@code prod,sandbox} fails too.
     */
    @PostConstruct
    void rejectSandboxCodeOutsideSandbox() {
        if (sandboxCode.isEmpty()) {
            return;
        }
        String conflicting = null;
        for (String deployment : LocalProfileGuard.DEPLOYMENT_PROFILES) {
            if (!SANDBOX_PROFILE.equals(deployment) && environment.matchesProfiles(deployment)) {
                conflicting = deployment;
            }
        }
        if (conflicting != null || !environment.matchesProfiles(SANDBOX_PROFILE)) {
            throw new IllegalStateException(
                    "draazy.otp.sandbox-code is set, but the active profiles are not '"
                            + SANDBOX_PROFILE + "' alone"
                            + (conflicting == null ? "" : " ('" + conflicting + "' is also active)")
                            + ". This makes every login code predictable. Unset it (check "
                            + "DRAAZY_OTP_SANDBOX_CODE in the process environment, not only the "
                            + "properties files), or activate '" + SANDBOX_PROFILE + "' on its own.");
        }
    }

    /**
     * Generate a login code, persist its hash, and dispatch it. Rate-limited three ways and
     * {@code noRollbackFor} its refusals, both load-bearing — see docs/flows/consumer/auth.md.
     */
    @Transactional(noRollbackFor = {RateLimitedException.class,
            OtpSender.DeliveryFailedException.class})
    public void sendLoginCode(String mobile) {
        sendCode(mobile, OtpCode.PURPOSE_LOGIN);
    }

    /**
     * Issue a code for any declared purpose. Every limit is keyed on (mobile, purpose) so a code
     * minted for one flow is worthless in another; {@code noRollbackFor}: docs/flows/consumer/auth.md
     */
    @Transactional(noRollbackFor = {RateLimitedException.class,
            OtpSender.DeliveryFailedException.class})
    public void sendCode(String mobile, String purpose) {
        budget.enforce(mobile, purpose);
        // Two keys, never both set. Everything after this line is identical either way, so a suite
        // exercises the real storage and consume path.
        String preset = fixedCode.isEmpty() ? sandboxCode : fixedCode;
        String code = preset.isEmpty()
                ? String.format("%06d", RANDOM.nextInt(1_000_000))
                : preset;
        repository.save(new OtpCode(mobile, Tokens.sha256Hex(code), purpose,
                Instant.now().plus(TTL)));
        // Nothing is caught here on purpose: a delivery failure arrives already named and spared
        // from rollback, so the row survives and the attempt spends its slot.
        sender.send(mobile, code);
    }

    /**
     * Validate {@code code} against the newest unconsumed login OTP and consume it on success. The
     * attempt bookkeeping must survive the thrown 401/429, hence {@code noRollbackFor}.
     */
    @Transactional(noRollbackFor = {UnauthorizedException.class, RateLimitedException.class})
    public void verifyLoginCode(String mobile, String code) {
        verifyCode(mobile, code, OtpCode.PURPOSE_LOGIN);
    }

    /**
     * Validate {@code code} against the newest unconsumed OTP for {@code (mobile, purpose)}. Scoped
     * by purpose for the reason given on {@link #sendCode}.
     */
    @Transactional(noRollbackFor = {UnauthorizedException.class, RateLimitedException.class})
    public void verifyCode(String mobile, String code, String purpose) {
        OtpCode otp = repository
                .findFirstByMobileAndPurposeAndConsumedFalseOrderByCreatedAtDesc(
                        mobile, purpose)
                .orElseThrow(() -> new UnauthorizedException("No active OTP — request a new code"));

        if (otp.isExpired()) {
            throw new UnauthorizedException("OTP expired — request a new code");
        }
        if (otp.getAttempts() >= maxVerifyAttempts) {
            // Consuming makes the lockout explicit and forces a fresh code rather than leaving a
            // poisoned row queryable.
            otp.consume();
            // The code is burned, so the remedy is a fresh code: Retry-After 0 = "request one now".
            throw new RateLimitedException(ErrorCodes.OTP_ATTEMPTS_EXHAUSTED,
                    "Too many attempts — request a new code", 0);
        }

        if (!Tokens.hashesEqual(Tokens.sha256Hex(code), otp.getCodeHash())) {
            otp.recordAttempt();
            // Told to the caller so the screen can count down; it reveals nothing, since only the
            // holder of the delivered code reaches this branch. Derived after the increment.
            throw new OtpIncorrectException(maxVerifyAttempts - otp.getAttempts());
        }
        otp.consume();
    }
}
