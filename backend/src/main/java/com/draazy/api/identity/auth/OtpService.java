package com.draazy.api.identity.auth;

import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.common.persistence.RateLimitLock;
import com.draazy.api.provider.OtpSender;
import jakarta.annotation.PostConstruct;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
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
     * via {@code draazy.otp.send-cooldown-seconds} so local development can drop the wait to zero
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
     * overridable via {@code draazy.otp.max-sends-per-window}. The default is the production value;
     * only local dev loosens it, and only for a keyless mock sender that rings no real phone.
     */
    static final int MAX_SENDS_PER_WINDOW = 5;

    private static final SecureRandom RANDOM = new SecureRandom();

    private final OtpCodeRepository repository;
    private final OtpSender sender;
    /** Makes the budget check below atomic with the send it guards (D73). */
    private final RateLimitLock locks;
    /** Enforced cooldown between codes; {@link #SEND_COOLDOWN} unless overridden for local dev. */
    private final Duration sendCooldown;
    /** Enforced per-window ceiling; {@link #MAX_SENDS_PER_WINDOW} unless overridden for local dev. */
    private final int maxSendsPerWindow;

    /**
     * When non-blank, the code every {@link #sendCode} issues instead of a random one, so a browser
     * suite can type it rather than scrape it out of the backend's console.
     *
     * <p><strong>Why this exists.</strong> Logging in is the first thing almost every e2e spec does,
     * and the only way to learn a random code is to read the log {@code MockOtpSender} writes it to.
     * One shared log cannot tell two concurrent logins whose code is whose, so that technique pins
     * the suite to {@code workers: 1}. Making the digits predictable removes the scrape, and with it
     * the reason the suite must run serially.
     *
     * <p><strong>What it deliberately does not weaken.</strong> Only the choice of digits. The code
     * is still hashed into {@code otp_codes}, still single-use, still expires on {@link #TTL}, and
     * both the send budget and the per-code attempt cap are untouched — so the flow a spec exercises
     * is the real one, not a bypass around it. Verification is not special-cased anywhere: a wrong
     * code still fails, which is what keeps the negative-path specs honest.
     *
     * <p><strong>Guarded three ways</strong>, because a predictable login code is a bypass wearing a
     * properties key. It is empty by default, so no profile inherits it; {@code application-prod
     * .properties} pins it back to empty, so {@code prod,e2e} cannot turn it on; and
     * {@link #rejectFixedCodeInProduction} refuses to finish booting if it is set while {@code prod}
     * is active, which is the backstop for the one route a properties file cannot cover — someone
     * exporting {@code DRAAZY_OTP_FIXED_CODE} into a deployment's environment.
     */
    private final String fixedCode;

    /** Consulted only by {@link #rejectFixedCodeInProduction}, to read the active profiles. */
    private final Environment environment;

    public OtpService(OtpCodeRepository repository, OtpSender sender, RateLimitLock locks,
            Environment environment,
            @Value("${draazy.otp.send-cooldown-seconds:60}") long sendCooldownSeconds,
            @Value("${draazy.otp.max-sends-per-window:5}") int maxSendsPerWindow,
            @Value("${draazy.otp.fixed-code:}") String fixedCode) {
        this.repository = repository;
        this.sender = sender;
        this.locks = locks;
        this.environment = environment;
        this.sendCooldown = Duration.ofSeconds(sendCooldownSeconds);
        this.maxSendsPerWindow = maxSendsPerWindow;
        this.fixedCode = fixedCode == null ? "" : fixedCode.trim();
    }

    /**
     * Kill the boot if a deployment is carrying a predictable login code.
     *
     * <p>Modelled on {@link com.draazy.api.security.DevProfileGuard}: the check runs after every
     * bean exists but before the connector accepts traffic, so the process dies during startup
     * rather than serving one request with a login anyone can guess. Bound to {@code prod} being
     * active rather than to "not e2e", for the same reason the dev stubs are: an unrecognised or
     * mistyped profile must land on the safe side, and {@code prod} is the one positive statement
     * that a deployment always makes.
     *
     * <p>The message names the property and both ways it can arrive, because the failure it
     * describes is a configuration mistake made somewhere other than the file being read.
     */
    @PostConstruct
    void rejectFixedCodeInProduction() {
        if (!fixedCode.isEmpty() && environment.acceptsProfiles(Profiles.of("prod"))) {
            throw new IllegalStateException(
                    "draazy.otp.fixed-code is set while the 'prod' profile is active. This makes "
                            + "every login code predictable. Unset it (check E2E_OTP_CODE and "
                            + "DRAAZY_OTP_FIXED_CODE in the process environment, not only the "
                            + "properties files) or drop the 'prod' profile.");
        }
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
     *
     * <p>{@link OtpSender.DeliveryFailedException} rides the same rule for the reason given on
     * {@link #sendCode}: a failed send must still spend the budget it just consumed.
     */
    @Transactional(noRollbackFor = {RateLimitedException.class,
            OtpSender.DeliveryFailedException.class})
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
     *
     * <p><strong>{@link OtpSender.DeliveryFailedException} is on the list because the send budget is
     * derived from rows, not from a counter.</strong> A delivery failure that rolled this transaction
     * back would take the {@code otp_codes} row with it, and the attempt would cost <em>nothing</em>:
     * no cooldown, no window slot, no trace. The one limit standing between a chosen number and being
     * rung on demand would be refunded on every failed call — and it degrades under load rather than
     * holding, because a vendor throttles per-account, so the failure rate climbs with the volume of
     * the abuse. It is also a plain correctness bug in the ordinary case: a call that times out after
     * the message was already accepted leaves the user holding six digits with no row to verify them
     * against. This entry point is the one where it bites hardest — the consent flow sends to a
     * landlord's number the caller names, who usually has no account, so a refundable budget here is
     * a free doorbell pointed at an arbitrary stranger.
     *
     * <p><strong>Why the annotation rather than moving the send out of the transaction.</strong> The
     * alternatives are a {@code REQUIRES_NEW} inner commit or an after-commit hook. Both make the OTP
     * row escape the rollback that every {@code @Transactional} test relies on, so the auth suite
     * would start leaking rows into its own send budget; and an after-commit hook does not fire under
     * a test transaction at all, which would leave the delivery path untested by construction.
     *
     * <p><strong>A participating advice cannot enforce this rule for its callers.</strong>
     * {@code noRollbackFor} here stops <em>this</em> advice from marking a shared transaction
     * rollback-only; it does nothing to an outer advice that owns the transaction and evaluates its
     * own rules. So every method that can own a transaction around a send has to name the type
     * itself. Today that is exactly four: {@link #sendLoginCode}, this method,
     * {@code AuthService.login} and {@code FlatmateSupplyService.ownerConsent}.
     * {@code FlatmateOwnerConsentService.send} does not need it because it is not transactional.
     * <strong>A new transactional caller that omits it silently restores the refund</strong> —
     * nothing throws, no test goes red, the budget just quietly stops being spent.
     */
    @Transactional(noRollbackFor = {RateLimitedException.class,
            OtpSender.DeliveryFailedException.class})
    public void sendCode(String mobile, String purpose) {
        enforceSendBudget(mobile, purpose);
        // The fixed code is an e2e affordance and nothing else; see the `fixedCode` field for the
        // three guards that keep it out of a deployment. Everything after this line is identical
        // either way, which is the point - the suite exercises the real storage and consume path.
        String code = fixedCode.isEmpty()
                ? String.format("%06d", RANDOM.nextInt(1_000_000))
                : fixedCode;
        repository.save(new OtpCode(mobile, Tokens.sha256Hex(code), purpose,
                Instant.now().plus(TTL)));
        // Nothing is caught here on purpose. A delivery failure arrives already named
        // (OtpSender.DeliveryFailedException) and is spared from rollback by the advice above, so
        // the row survives and the attempt spends its slot. Anything else - a missing provider, a
        // bug inside a sender, an already-aborted transaction - is not a delivery attempt and must
        // roll back. Catching RuntimeException here and relabelling would erase that distinction,
        // and the seam is the only place that can actually tell the two apart.
        sender.send(mobile, code);
    }

    /**
     * Throw {@link RateLimitedException} if {@code mobile} has already had its share of codes for
     * this purpose.
     *
     * <p>Reads at most {@link #MAX_SENDS_PER_WINDOW} rows — enough to answer both questions from one
     * query: the newest row gives the cooldown, and a full page means the window budget is spent, with
     * its oldest row saying when the budget frees up.
     *
     * <p><strong>Locked first, and this is the whole of D73 at this call site.</strong> Read and then
     * insert is not a budget under concurrency: two requests naming the same number both read the
     * page before either has written to it, both find room, and both cause an SMS. A cooldown of
     * sixty seconds is defeated by arriving twice in the same millisecond, which is the one thing a
     * script finds easier than a person. Holding the lock across the read <em>and</em> the save in
     * {@link #sendCode} — the transaction is what joins them — makes the loser's page the winner's
     * page plus one row, so it is refused with the truthful {@code Retry-After} it should have had.
     * Keyed on (mobile, purpose) to match what the limits are keyed on: two purposes have separate
     * budgets and must not queue behind each other.
     */
    private void enforceSendBudget(String mobile, String purpose) {
        locks.holdUntilCommit(RateLimitLock.Limit.OTP_SEND, mobile + ":" + purpose);
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
