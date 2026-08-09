package com.punenest.api.identity.auth;

import com.punenest.api.common.error.RateLimitedException;
import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.provider.OtpSender;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The mobile-OTP primitive behind passwordless login (ADR-008, L1). Codes are 6 digits, stored only
 * as a SHA-256 hash (short-lived + attempt-capped, so a fast digest is sufficient — same reasoning as
 * refresh tokens), single-use, and 5-minute-lived. Delivery goes through the {@link OtpSender} seam so
 * the app runs with zero paid keys (dev logs the code; prod wires a real SMS gateway).
 *
 * <p>Verification is the sensitive path: it caps attempts per code to blunt online brute-forcing of
 * the 10^6 space, and consumes the code on success so it can't be replayed.
 */
@Service
public class OtpService {

    /** Short enough to limit exposure of a delivered code, long enough for real SMS latency. */
    static final Duration TTL = Duration.ofMinutes(5);
    /** Online-guess ceiling per code before it's burned (10^6 space ⇒ this keeps brute force infeasible). */
    static final int MAX_ATTEMPTS = 5;

    /**
     * Secure default for the minimum gap between two codes to the same mobile. Covers the "user
     * pressed resend twice" case and blunts rapid-fire bombing; comfortably shorter than {@link #TTL},
     * so a person who genuinely never received the SMS is never told to wait for a code that has
     * already expired.
     *
     * <p>The <em>enforced</em> gap is {@link #sendCooldown}, which defaults to this but is overridable
     * via {@code punenest.otp.send-cooldown-seconds} so local development can drop the wait to zero
     * (the base {@code application.properties} does; {@code application-prod.properties} pins it back).
     */
    static final Duration SEND_COOLDOWN = Duration.ofSeconds(60);
    /** Rolling window over which the send budget applies. */
    static final Duration SEND_WINDOW = Duration.ofHours(1);
    /**
     * Secure default for codes per mobile per {@link #SEND_WINDOW}. Above any believable honest retry
     * count (a real user who fails five times in an hour has a delivery problem an SMS cannot fix),
     * and low enough that a targeted victim's phone cannot be used as a doorbell.
     *
     * <p>The <em>enforced</em> ceiling is {@link #maxSendsPerWindow}, which defaults to this but is
     * overridable via {@code punenest.otp.max-sends-per-window}. The default is the production value;
     * only local dev loosens it, and only for a keyless mock sender that rings no real phone.
     */
    static final int MAX_SENDS_PER_WINDOW = 5;

    private static final SecureRandom RANDOM = new SecureRandom();

    private final OtpCodeRepository repository;
    private final OtpSender sender;
    /** Enforced cooldown between codes; {@link #SEND_COOLDOWN} unless overridden for local dev. */
    private final Duration sendCooldown;
    /** Enforced per-window ceiling; {@link #MAX_SENDS_PER_WINDOW} unless overridden for local dev. */
    private final int maxSendsPerWindow;

    public OtpService(OtpCodeRepository repository, OtpSender sender,
            @Value("${punenest.otp.send-cooldown-seconds:60}") long sendCooldownSeconds,
            @Value("${punenest.otp.max-sends-per-window:5}") int maxSendsPerWindow) {
        this.repository = repository;
        this.sender = sender;
        this.sendCooldown = Duration.ofSeconds(sendCooldownSeconds);
        this.maxSendsPerWindow = maxSendsPerWindow;
    }

    /**
     * Generate a fresh login code for {@code mobile}, persist its hash, and dispatch it. Any prior
     * unconsumed code is left to expire; the newest one wins on verify (repository orders by newest).
     *
     * <p><strong>Rate limited, and the contract says so</strong> — {@code POST /auth/login} is the only
     * operation in the spec that declares a {@code 429}. This path is unauthenticated and, in prod,
     * spends real money and rings a real phone on every call, with the <em>attacker</em> choosing whose
     * phone. Left open it is a harassment tool ("bomb this number") and a billing tap; the per-code
     * attempt cap in {@link #verifyLoginCode} does not help, because that limits guesses against one
     * code, not how many codes you may cause to be sent.
     *
     * <p>Two limits, both keyed on the recipient: a {@link #SEND_COOLDOWN} between consecutive codes,
     * and at most {@link #MAX_SENDS_PER_WINDOW} per {@link #SEND_WINDOW}. Keying on the mobile — not on
     * the caller — is the point: the number is what gets harassed and billed, and it is the one thing
     * an attacker cannot rotate while still attacking a chosen victim.
     *
     * <p>The 429 carries a truthful {@code Retry-After}, and is returned identically whether or not the
     * number has an account, so it stays useless as a registration oracle.
     *
     * <p><strong>{@code noRollbackFor} the refusal, and this is the annotation that matters</strong>
     * (tech-debt D90). {@code AuthService.login} is itself {@code @Transactional}, so this advice
     * <em>participates</em> in its transaction rather than owning one. Without the rule, a refusal
     * marks that shared transaction rollback-only; {@code login} then honours its own
     * {@code noRollbackFor}, attempts the commit, and gets an {@code UnexpectedRollbackException}
     * that the catch-all renders as {@code 500 internal} — so the message above and its
     * {@code Retry-After} never reach the caller, and the user is told the server broke when in fact
     * they were told to wait. Nothing is written before the budget check runs, so there is no state
     * a rollback would be protecting. The internal call below is <em>not</em> proxied, which is why
     * the rule has to be here and not only on {@link #sendCode}; the two are separate entry points
     * and each needs it for its own callers.
     */
    @Transactional(noRollbackFor = RateLimitedException.class)
    public void sendLoginCode(String mobile) {
        sendCode(mobile, OtpCode.PURPOSE_LOGIN);
    }

    /**
     * Issue a code for any declared purpose.
     *
     * <p><strong>Every limit is keyed on (mobile, purpose), and that is load-bearing.</strong> The
     * flatmates owner-consent flow sends a code to a landlord who usually has no account, to confirm
     * they know their tenant is seeking a replacement. Sharing the {@code login} purpose would have
     * made "request consent" a way to mint <em>login</em> codes for any number a caller can name,
     * turning a consent form into an account-takeover primitive. Separate purposes mean a consent
     * code can never be presented at {@code /auth/login}, and neither flow can exhaust the other's
     * send budget.
     *
     * <p>The throttle itself is shared on purpose: it is the security-critical part, and two copies
     * of a rate limiter is one copy that will be forgotten when the rule changes.
     *
     * <p><strong>{@code noRollbackFor} for the reason given on {@link #sendLoginCode}</strong> — here
     * it covers the cross-bean call from {@code FlatmateSupplyService}, which is transactional for
     * the same reason {@code AuthService.login} is.
     */
    @Transactional(noRollbackFor = RateLimitedException.class)
    public void sendCode(String mobile, String purpose) {
        enforceSendBudget(mobile, purpose);
        String code = String.format("%06d", RANDOM.nextInt(1_000_000));
        repository.save(new OtpCode(mobile, Tokens.sha256Hex(code), purpose,
                Instant.now().plus(TTL)));
        sender.send(mobile, code);
    }

    /**
     * Throw {@link RateLimitedException} if {@code mobile} has already had its share of codes for
     * this purpose.
     *
     * <p>Reads at most {@link #MAX_SENDS_PER_WINDOW} rows — enough to answer both questions from one
     * query: the newest row gives the cooldown, and a full page means the window budget is spent, with
     * its oldest row saying when the budget frees up.
     */
    private void enforceSendBudget(String mobile, String purpose) {
        List<OtpCode> recent = repository.findByMobileAndPurposeOrderByCreatedAtDesc(
                mobile, purpose, PageRequest.of(0, maxSendsPerWindow));
        if (recent.isEmpty()) {
            return;
        }
        Instant now = Instant.now();

        Instant readyAt = recent.get(0).getCreatedAt().plus(sendCooldown);
        if (now.isBefore(readyAt)) {
            throw new RateLimitedException(
                    "A code was just sent — wait a moment before requesting another",
                    secondsUntil(now, readyAt));
        }
        if (recent.size() >= maxSendsPerWindow) {
            // why the oldest of the page: it is the send that will fall out of the window first, so
            // its expiry is the exact moment a slot reopens.
            Instant windowFreesAt = recent.get(recent.size() - 1).getCreatedAt().plus(SEND_WINDOW);
            if (now.isBefore(windowFreesAt)) {
                throw new RateLimitedException(
                        "Too many login codes requested for this number — try again later",
                        secondsUntil(now, windowFreesAt));
            }
        }
    }

    /** Whole seconds from {@code now} until {@code target}, rounded up and never below 1. */
    private static int secondsUntil(Instant now, Instant target) {
        // why round up: a truthful Retry-After must not point at an instant that is still too early,
        // or a client that obeys it exactly gets a second 429.
        long millis = Duration.between(now, target).toMillis();
        return (int) Math.max(1, (millis + 999) / 1000);
    }

    /**
     * Validate {@code code} against the newest unconsumed login OTP for {@code mobile}. Consumes it on
     * success. Throws {@link UnauthorizedException} for no/expired/wrong code and
     * {@link RateLimitedException} once the per-code attempt cap is hit.
     *
     * <p>{@code noRollbackFor} the domain errors: a wrong guess records an attempt and a capped code is
     * burned — that state must persist despite the thrown 401/429, or the attempt cap resets every
     * request and the brute-force ceiling is defeated (this ran unbounded in prod once; shared-tx tests
     * masked it).
     */
    @Transactional(noRollbackFor = {UnauthorizedException.class, RateLimitedException.class})
    public void verifyLoginCode(String mobile, String code) {
        verifyCode(mobile, code, OtpCode.PURPOSE_LOGIN);
    }

    /**
     * Validate {@code code} against the newest unconsumed OTP for {@code (mobile, purpose)}.
     *
     * <p>Scoped by purpose for the reason given on {@link #sendCode}: a code issued for one flow must
     * be worthless in another.
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
        if (otp.getAttempts() >= MAX_ATTEMPTS) {
            // ponytail: burning here isn't required (attempts already >= cap), but consuming makes the
            // lockout explicit and forces a fresh code rather than leaving a poisoned row queryable.
            otp.consume();
            // why: the code is burned, so the remedy is a fresh code — Retry-After 0 = "request one now".
            throw new RateLimitedException("Too many attempts — request a new code", 0);
        }

        if (!Tokens.hashesEqual(Tokens.sha256Hex(code), otp.getCodeHash())) {
            otp.recordAttempt();
            throw new UnauthorizedException("Incorrect OTP");
        }
        otp.consume();
    }
}
