package com.draazy.api.identity.auth;

import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.persistence.RateLimitLock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * Decides whether another login code may be sent, and refuses with a truthful {@code Retry-After}.
 * Limits, locking and the deliberate absence of {@code @Transactional}: docs/flows/consumer/auth.md
 */
@Component
public class OtpSendBudget {

    /**
     * Secure default gap between two codes to one mobile. Comfortably shorter than
     * {@link OtpService#TTL}; the enforced gap is {@link #sendCooldown}, which local dev may zero.
     */
    static final Duration SEND_COOLDOWN = Duration.ofSeconds(60);

    /** Rolling window over which both send budgets apply. */
    static final Duration SEND_WINDOW = Duration.ofHours(1);

    /**
     * Secure default for codes per mobile per {@link #SEND_WINDOW}: above any believable honest retry
     * count, low enough that a victim's phone cannot be used as a doorbell. Only local dev loosens it.
     */
    static final int MAX_SENDS_PER_WINDOW = 5;

    /**
     * Secure default for codes across <em>every</em> recipient per {@link #SEND_WINDOW} — a spend
     * ceiling for the attacker who rotates the number. Rationale: docs/flows/consumer/auth.md
     */
    static final int MAX_PLATFORM_SENDS_PER_WINDOW = 500;

    private final OtpCodeRepository repository;
    /** Makes the per-recipient check atomic with the send it guards. */
    private final RateLimitLock locks;
    /** Enforced cooldown; {@link #SEND_COOLDOWN} unless overridden for local dev. */
    private final Duration sendCooldown;
    /** Enforced per-mobile ceiling; {@link #MAX_SENDS_PER_WINDOW} unless overridden for local dev. */
    private final int maxSendsPerWindow;
    /** Enforced platform-wide ceiling; {@link #MAX_PLATFORM_SENDS_PER_WINDOW} unless overridden. */
    private final int maxPlatformSendsPerWindow;

    public OtpSendBudget(OtpCodeRepository repository, RateLimitLock locks,
            @Value("${draazy.otp.send-cooldown-seconds:60}") long sendCooldownSeconds,
            @Value("${draazy.otp.max-sends-per-window:5}") int maxSendsPerWindow,
            @Value("${draazy.otp.max-platform-sends-per-window:500}") int maxPlatformSendsPerWindow) {
        this.repository = repository;
        this.locks = locks;
        this.sendCooldown = Duration.ofSeconds(sendCooldownSeconds);
        this.maxSendsPerWindow = maxSendsPerWindow;
        this.maxPlatformSendsPerWindow = maxPlatformSendsPerWindow;
    }

    /**
     * The gap this environment enforces, in whole seconds, published on the send acknowledgement so a
     * client counts down the interval the server will actually refuse on.
     */
    int sendCooldownSeconds() {
        return (int) sendCooldown.toSeconds();
    }

    /**
     * Throw {@link RateLimitedException} if this send may not happen. Locked before the read, and the
     * platform ceiling before the per-recipient page — see docs/flows/consumer/auth.md.
     */
    void enforce(String mobile, String purpose) {
        locks.holdUntilCommit(RateLimitLock.Limit.OTP_SEND, mobile + ":" + purpose);
        enforcePlatformBudget();
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
            // The oldest of the page falls out of the window first, so its expiry is the exact
            // moment a slot reopens.
            Instant windowFreesAt = recent.get(recent.size() - 1).getCreatedAt().plus(SEND_WINDOW);
            if (now.isBefore(windowFreesAt)) {
                throw new RateLimitedException(
                        "Too many login codes requested for this number — try again later",
                        secondsUntil(now, windowFreesAt));
            }
        }
    }

    /**
     * Throw {@link RateLimitedException} once the platform has spent its share for this window. Read
     * without a lock and phrased to reveal nothing — see docs/flows/consumer/auth.md.
     */
    private void enforcePlatformBudget() {
        Instant now = Instant.now();
        List<Instant> sends = repository.findSendTimesSince(
                now.minus(SEND_WINDOW), PageRequest.of(0, maxPlatformSendsPerWindow));
        if (sends.size() < maxPlatformSendsPerWindow) {
            return;
        }
        Instant windowFreesAt = sends.get(0).plus(SEND_WINDOW);
        if (now.isBefore(windowFreesAt)) {
            throw new RateLimitedException(
                    "Login codes are temporarily unavailable — please try again later",
                    secondsUntil(now, windowFreesAt));
        }
    }

    /** Whole seconds from {@code now} until {@code target}, rounded up and never below 1. */
    private static int secondsUntil(Instant now, Instant target) {
        // Rounded up: a Retry-After pointing at an instant still too early earns a second 429.
        long millis = Duration.between(now, target).toMillis();
        return (int) Math.max(1, (millis + 999) / 1000);
    }
}
