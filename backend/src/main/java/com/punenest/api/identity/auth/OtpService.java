package com.punenest.api.identity.auth;

import com.punenest.api.common.error.RateLimitedException;
import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.provider.OtpSender;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
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

    private static final SecureRandom RANDOM = new SecureRandom();

    private final OtpCodeRepository repository;
    private final OtpSender sender;

    public OtpService(OtpCodeRepository repository, OtpSender sender) {
        this.repository = repository;
        this.sender = sender;
    }

    /**
     * Generate a fresh login code for {@code mobile}, persist its hash, and dispatch it. Any prior
     * unconsumed code is left to expire; the newest one wins on verify (repository orders by newest).
     */
    @Transactional
    public void sendLoginCode(String mobile) {
        String code = String.format("%06d", RANDOM.nextInt(1_000_000));
        repository.save(new OtpCode(mobile, Tokens.sha256Hex(code), OtpCode.PURPOSE_LOGIN,
                Instant.now().plus(TTL)));
        sender.send(mobile, code);
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
        OtpCode otp = repository
                .findFirstByMobileAndPurposeAndConsumedFalseOrderByCreatedAtDesc(
                        mobile, OtpCode.PURPOSE_LOGIN)
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
