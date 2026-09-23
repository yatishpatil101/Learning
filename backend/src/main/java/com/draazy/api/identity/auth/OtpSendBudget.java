package com.draazy.api.identity.auth;

import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.persistence.RateLimitLock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/** Decides whether another code may be sent, and refuses with a truthful {@code Retry-After}.
 * Limits, locking and the deliberate absence of {@code @Transactional}: docs/flows/consumer/auth.md */
@Component
public class OtpSendBudget {

    /** Secure default gap between two codes to one mobile. The enforced gap is {@link #sendCooldown},
     * which local dev may zero. */
    static final Duration SEND_COOLDOWN = Duration.ofSeconds(60);

    /** Rolling window over which both send budgets apply. */
    static final Duration SEND_WINDOW = Duration.ofHours(1);

    /** Secure default for codes per mobile per {@link #SEND_WINDOW}: above any honest retry count,
     * low enough that a victim's phone cannot be used as a doorbell. Only local dev loosens it. */
    static final int MAX_SENDS_PER_WINDOW = 5;

    /** Secure default for codes across <em>every</em> recipient per {@link #SEND_WINDOW} — a spend
     * ceiling for the attacker who rotates the number. Rationale: docs/flows/consumer/auth.md */
    static final int MAX_PLATFORM_SENDS_PER_WINDOW = 500;

    /** Secure default for codes of any one non-login purpose per {@link #SEND_WINDOW}: a flow whose
     * caller names others' numbers would otherwise drain the single pool sign-in draws from. */
    static final int MAX_PURPOSE_SENDS_PER_WINDOW = 100;

    /** Secure default for codes one <em>account</em> may request of a non-login purpose per
     * {@link #SEND_WINDOW}. The only ceiling a caller cannot rotate out of by naming a new number. */
    static final int MAX_CALLER_SENDS_PER_WINDOW = 5;

    /** Share of {@link #MAX_PURPOSE_SENDS_PER_WINDOW} held back for accounts that have spent nothing
     * this window, so twenty throwaway accounts cannot leave the flow first-come. Caps it at 150. */
    static final int MAX_PURPOSE_RESERVE_SENDS_PER_WINDOW = 50;

    /** Advertised when the per-caller lock is held — not a spent budget, it clears when the winner
     * commits. Borrowing {@link #sendCooldown} would sell a two-second wait as a minute. */
    private static final int LOCK_CONTENTION_RETRY_SECONDS = 5;

    private final OtpCodeRepository repository;
    /** Makes the per-recipient and per-caller checks atomic with the send they guard. */
    private final RateLimitLock locks;
    /** Enforced cooldown; {@link #SEND_COOLDOWN} unless overridden for local dev. */
    private final Duration sendCooldown;
    /** Enforced per-mobile ceiling; {@link #MAX_SENDS_PER_WINDOW} unless overridden for local dev. */
    private final int maxSendsPerWindow;
    /** Enforced platform-wide ceiling; {@link #MAX_PLATFORM_SENDS_PER_WINDOW} unless overridden. */
    private final int maxPlatformSendsPerWindow;
    /** Enforced per-purpose share; {@link #MAX_PURPOSE_SENDS_PER_WINDOW} unless overridden. */
    private final int maxPurposeSendsPerWindow;
    /** Enforced per-caller quota; {@link #MAX_CALLER_SENDS_PER_WINDOW} unless overridden. */
    private final int maxCallerSendsPerWindow;

    public OtpSendBudget(OtpCodeRepository repository, RateLimitLock locks,
            @Value("${draazy.otp.send-cooldown-seconds:60}") long sendCooldownSeconds,
            @Value("${draazy.otp.max-sends-per-window:5}") int maxSendsPerWindow,
            @Value("${draazy.otp.max-platform-sends-per-window:500}") int maxPlatformSendsPerWindow,
            @Value("${draazy.otp.max-purpose-sends-per-window:100}") int maxPurposeSendsPerWindow,
            @Value("${draazy.otp.max-caller-sends-per-window:5}") int maxCallerSendsPerWindow) {
        this.repository = repository;
        this.locks = locks;
        this.sendCooldown = Duration.ofSeconds(sendCooldownSeconds);
        this.maxSendsPerWindow = maxSendsPerWindow;
        this.maxPlatformSendsPerWindow = maxPlatformSendsPerWindow;
        this.maxPurposeSendsPerWindow = maxPurposeSendsPerWindow;
        this.maxCallerSendsPerWindow = maxCallerSendsPerWindow;
    }

    /** The gap this environment enforces, published on the send acknowledgement so a client counts
     * down the interval the server will actually refuse on. */
    int sendCooldownSeconds() {
        return (int) sendCooldown.toSeconds();
    }

    /** Throw {@link RateLimitedException} if this send may not happen; ordering rationale in
     * docs/flows/consumer/auth.md. Keyed on {@link #family(String)} — the caller picks the scope. */
    void enforce(String mobile, String purpose, UUID requestedBy) {
        String family = family(purpose);
        locks.holdUntilCommit(RateLimitLock.Limit.OTP_SEND, mobile + ":" + family);
        // Namespace order, and tried rather than waited for — see RateLimitLock#tryHoldUntilCommit.
        if (requestedBy != null && !locks.tryHoldUntilCommit(
                RateLimitLock.Limit.OTP_SEND_CALLER, requestedBy + ":" + family)) {
            throw new RateLimitedException(
                    "A code you asked for is still being sent — wait for it before asking again",
                    LOCK_CONTENTION_RETRY_SECONDS);
        }
        enforcePlatformBudget();
        enforcePurposeBudget(family, requestedBy);
        enforceCallerBudget(requestedBy, family);
        List<Instant> recent = repository.findRecentSendTimesForRecipient(
                mobile, family, PageRequest.of(0, maxSendsPerWindow));
        if (recent.isEmpty()) {
            return;
        }
        Instant now = Instant.now();
        Instant readyAt = recent.get(0).plus(sendCooldown);
        if (now.isBefore(readyAt)) {
            throw new RateLimitedException(
                    "A code was just sent — wait a moment before requesting another",
                    secondsUntil(now, readyAt));
        }
        if (recent.size() >= maxSendsPerWindow) {
            // Newest first here, so the page's last row is the oldest send still inside the budget.
            refuseUntilWindowFrees(now, recent.get(recent.size() - 1),
                    "Too many login codes requested for this number — try again later");
        }
    }

    /** Throw {@link RateLimitedException} once the platform has spent its share for this window.
     * Read without a lock and phrased to reveal nothing — see docs/flows/consumer/auth.md. */
    private void enforcePlatformBudget() {
        Instant now = Instant.now();
        List<Instant> sends = repository.findSendTimesSince(
                now.minus(SEND_WINDOW), PageRequest.of(0, maxPlatformSendsPerWindow));
        if (sends.size() < maxPlatformSendsPerWindow) {
            return;
        }
        refuseUntilWindowFrees(now, sends.get(0),
                "Login codes are temporarily unavailable — please try again later");
    }

    /** Throw {@link RateLimitedException} once one non-login flow has spent its share of the window.
     * Above the share it narrows rather than closes — see {@link #MAX_PURPOSE_RESERVE_SENDS_PER_WINDOW}. */
    private void enforcePurposeBudget(String family, UUID requestedBy) {
        if (OtpCode.PURPOSE_LOGIN.equals(family)) {
            return;
        }
        Instant now = Instant.now();
        Instant since = now.minus(SEND_WINDOW);
        List<Instant> sends = repository.findSendTimesForPurposeSince(
                family, since, PageRequest.of(0, purposeReserveCeiling()));
        if (sends.size() < maxPurposeSendsPerWindow) {
            return;
        }
        if (requestedBy != null && sends.size() < purposeReserveCeiling()
                && hasSpentNothing(requestedBy, family, since)) {
            return;
        }
        // This page runs to the reserve ceiling, so count back to the last row whose expiry still
        // brings the count under the share — never earlier than the truth, or the wait lies.
        refuseUntilWindowFrees(now, sends.get(sends.size() - maxPurposeSendsPerWindow),
                "Codes for this are temporarily unavailable — please try again later");
    }

    /** Throw {@link RateLimitedException} once one account has spent its quota of a non-login flow.
     * May be specific where its siblings may not: the caller is authenticated and the count is theirs. */
    private void enforceCallerBudget(UUID requestedBy, String family) {
        if (requestedBy == null || OtpCode.PURPOSE_LOGIN.equals(family)) {
            return;
        }
        Instant now = Instant.now();
        List<Instant> sends = repository.findSendTimesForCallerSince(requestedBy, family,
                now.minus(SEND_WINDOW), PageRequest.of(0, maxCallerSendsPerWindow));
        if (sends.size() < maxCallerSendsPerWindow) {
            return;
        }
        refuseUntilWindowFrees(now, sends.get(0),
                "You have requested too many codes — try again later");
    }

    /** Refuse with {@code message} until {@code oldest} falls out of the window, the exact moment a
     * slot reopens. A no-op once it already has. */
    private static void refuseUntilWindowFrees(Instant now, Instant oldest, String message) {
        Instant windowFreesAt = oldest.plus(SEND_WINDOW);
        if (now.isBefore(windowFreesAt)) {
            throw new RateLimitedException(message, secondsUntil(now, windowFreesAt));
        }
    }

    /** The point past which the per-purpose share admits only callers who have spent nothing here. */
    private int purposeReserveCeiling() {
        return maxPurposeSendsPerWindow + MAX_PURPOSE_RESERVE_SENDS_PER_WINDOW;
    }

    /** Whether {@code requestedBy} has taken no code of this family in the window. */
    private boolean hasSpentNothing(UUID requestedBy, String family, Instant since) {
        return repository.findSendTimesForCallerSince(
                requestedBy, family, since, PageRequest.of(0, 1)).isEmpty();
    }

    /** The flow a purpose belongs to, with any per-subject scope (V32) dropped — counted whole, that
     * scope would re-arm every budget. Reaches a {@code LIKE} prefix, so a family must stay literal. */
    private static String family(String purpose) {
        int scope = purpose.indexOf(':');
        return scope < 0 ? purpose : purpose.substring(0, scope);
    }

    /** Whole seconds until {@code target}, never below 1 and rounded up: a {@code Retry-After}
     * pointing at an instant still too early earns a second 429. */
    private static int secondsUntil(Instant now, Instant target) {
        long millis = Duration.between(now, target).toMillis();
        return (int) Math.max(1, (millis + 999) / 1000);
    }
}
