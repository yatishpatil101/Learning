package com.draazy.api.identity.auth;

import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.security.JwtProperties;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issues and rotates refresh tokens with reuse-detection (ADR-008). Each successful refresh revokes
 * the presented token and mints a new one chained via {@code rotated_from}. If an already-revoked
 * token is presented again, that's a replay of a stolen/rotated token — the whole family for that
 * user is revoked and the caller is forced to re-authenticate.
 *
 * <p>The endpoint that calls this ({@code POST /auth/refresh}) is a later feature slice; this
 * service is the reusable machinery it will lean on.
 */
@Service
public class RefreshTokenService {

    private static final Logger log = LoggerFactory.getLogger(RefreshTokenService.class);

    /**
     * How far along a rotation chain a graced replay may be forgiven. Each hop is one tab that
     * already rotated inside the window, so three covers the realistic races and bounds the walk;
     * anything deeper is not a browser reloading, and falls through to reuse-detection.
     */
    private static final int MAX_GRACE_HOPS = 3;

    /**
     * How many <em>consecutive</em> graced replays one rotation chain may be forgiven before the
     * family is burned anyway.
     *
     * <p>Without a bound of some kind the grace window is not a window at all. A thief who holds a
     * stolen token and keeps rotating keeps the family's head permanently fresh, so every replay the
     * victim makes lands inside a window the thief is holding open — and the victim's rotation does
     * the same favour in return. The two ping-pong, each forgiven, and the tripwire never fires for
     * the full refresh TTL. {@link #MAX_GRACE_HOPS} does not bound this: every exchange is a single
     * hop, so the walk never gets deep enough to be cut off.
     *
     * <p>Counting <em>consecutive</em> graces rather than lifetime ones is what makes a small limit
     * safe. An honest client's contested rotation is isolated — it races, is forgiven, and then
     * rotates cleanly for hours, which resets the count to zero. The attack cannot: it is contested
     * at every single step by construction, because neither party ever holds the live head, so the
     * count only ever climbs. A lifetime counter would eventually sign out a merely flaky user, and
     * would do it for behaviour that was never suspicious.
     *
     * <p>Three tolerates the realistic races — N tabs waking together produce N-1 graces, so this
     * covers four simultaneous tabs — while capping a ping-pong at three forgiven replays before
     * both parties are logged out and the real user re-authenticates.
     *
     * <p>Package-private so {@code RefreshGraceWindowTest} can express "more graces than the limit,
     * but never consecutively" against the real number instead of a copy of it that could drift.
     */
    static final int MAX_CONSECUTIVE_GRACES = 3;

    private final RefreshTokenRepository repository;
    private final Duration ttl;
    private final Duration grace;

    public RefreshTokenService(RefreshTokenRepository repository, JwtProperties jwtProperties) {
        this.repository = repository;
        this.ttl = jwtProperties.refreshTtl();
        this.grace = jwtProperties.refreshGrace();
    }

    /** Mint the first refresh token of a session. Returns the raw token (only its hash is stored). */
    @Transactional
    public String issue(UUID userId) {
        String raw = Tokens.randomToken();
        repository.save(new RefreshToken(userId, Tokens.sha256Hex(raw), null,
                Instant.now().plus(ttl)));
        return raw;
    }

    /**
     * Rotate a presented refresh token. Returns the owning user id + a fresh raw token, or throws
     * {@link UnauthorizedException} on invalid/expired/reused tokens.
     *
     * <p><strong>{@code noRollbackFor} the 401, or the reuse tripwire below does nothing at all.</strong>
     * The theft path revokes the whole family and <em>then</em> throws. Without this rule that
     * revocation is discarded on the way out: this advice participates in {@code AuthService.refresh}'s
     * transaction rather than owning one, so the throw marks the shared transaction rollback-only and
     * every {@code revoke()} above is dirty state that never reaches the database. The caller still
     * sees 401 — which is exactly why it looked correct — but the sibling tokens stay live for the
     * full refresh TTL, and burning them is the entire point of detecting reuse.
     *
     * <p>The rule is needed <em>here as well as</em> on {@code refresh} for the reason spelled out on
     * {@link OtpService#sendLoginCode} (D90): a participating advice that marks the transaction
     * rollback-only cannot be overruled from outside, and the outer commit would fail with
     * {@code UnexpectedRollbackException} rendered as a 500. Both ends have to agree.
     *
     * <p>Nothing needs protecting on the other two 401s — the not-found and expired paths write
     * nothing before they throw.
     *
     * <p><strong>The grace window.</strong> Not every replay is theft. Two tabs wake with the same
     * token, both 401, both refresh; one wins and the other presents a token that was spent
     * milliseconds ago. Treated strictly that is indistinguishable from a stolen token, and the
     * honest user is signed out of every session — a security control firing on the person it exists
     * to protect, and the more reliably the flakier their connection. Since the refresh token moved
     * into an {@code HttpOnly} cookie the browser sends it automatically, so the client can no longer
     * compare token values to elect a winner before the request goes out, and the race is the
     * server's to settle.
     *
     * <p>So a token spent within {@link JwtProperties#refreshGrace} is forgiven, and the caller is
     * given the family's <em>current live head</em> rather than a second parallel token: the raw
     * value handed to the winner cannot be recovered (only its hash is stored), and minting a
     * sibling would break the one-live-token-per-family invariant that makes reuse-detection mean
     * anything. So the head is rotated again and both tabs end up on the same chain.
     *
     * <p>The cost is stated plainly: a thief who replays a stolen token inside the same few seconds
     * gets a session instead of burning the family. That is the trade every rotation scheme makes.
     * What makes it a bounded cost is {@link #MAX_CONSECUTIVE_GRACES}, and it is worth being precise
     * about why, because the obvious argument is wrong. "The window is only seconds" does <em>not</em>
     * bound it: a thief who keeps rotating holds the window open indefinitely, so thief and victim
     * can alternate forgiven replays for the whole thirty-day TTL without the tripwire ever firing.
     * The bound comes from counting consecutive graces per chain and burning the family on the limit
     * — the attack is contested at every step and so always reaches it, while an honest client's
     * isolated race is followed by a clean rotation that resets the count to zero.
     *
     * <p><strong>What the grace window does not fix, and who does.</strong> Forgiving the loser is
     * not the same as making the race harmless, because the two tabs are also racing to write the
     * cookie. Winner W rotates {@code T0} and its response carries {@code H1}; loser L is graced,
     * rotates {@code H1} — <em>revoking</em> it — and its response carries {@code H2}. Both responses
     * set the cookie and the jar keeps whichever lands last, so if W's lands second the browser is
     * left holding {@code H1}, which this method has already revoked. Nothing fails now: a refresh in
     * the next few seconds is graced. But the next refresh is normally fifteen minutes away, by which
     * time {@code H1}'s heir is far older than the floor, {@link #liveHeirWithinGrace} returns
     * {@code null}, and the user is signed out of every session by exactly the race the grace window
     * was added to survive. This is the one branch where the server invalidates a token it has just
     * handed to a different in-flight response, which is what makes it possible at all.
     *
     * <p>It cannot be closed here, and the two obvious server-side repairs both cost more than they
     * save. <em>Not revoking the heir on the graced path</em> — serving L a copy and letting the jar
     * settle on {@code H1} either way — fixes this case and breaks a commoner one: a single tab whose
     * response is dropped in flight retries with its spent token, is graced, and under that rule
     * receives no new cookie at all, so it is still holding a spent token when the window closes. The
     * re-rotation is what rescues the dropped-response case. <em>Grading against "an ancestor of the
     * live head, revoked recently"</em> does not address the scenario either: in the reorder case
     * {@code H1} was revoked fifteen minutes ago too, so it is outside any window that is not also
     * wide open to a genuine replay. Dropping the time bound entirely — "forgive any ancestor of an
     * unused live head" — would forgive a thief who lifts a token immediately after any rotation, for
     * as long as the victim stays idle. That is not a bound, it is the absence of one.
     *
     * <p>So the control lives on the client: {@code frontend/src/services/http.js} serialises refresh
     * across tabs with a Web Lock, which prevents the second request from ever being sent. That is
     * load-bearing rather than an optimisation, and it is documented as such there so nobody
     * simplifies it away. What remains uncovered is the single tab that loses its response and
     * retries outside the grace window; that one still burns the family, and is stated here rather
     * than claimed fixed.
     */
    @Transactional(noRollbackFor = UnauthorizedException.class)
    public Rotation rotate(String rawToken) {
        String hash = Tokens.sha256Hex(rawToken);
        /* Two reads of the same row, and the first one exists only to learn whose family this is.
         *
         * The family lock has to be taken before any row lock or it does not remove the ordering
         * freedom it exists to remove (see `lockFamily`), and the lock is keyed on the user — who is
         * not known until the token has been looked up. The way out is to look the owner up without
         * a lock, which is safe precisely because nothing is decided on it: `user_id` is written once
         * at insert and never updated, so the value cannot be stale, and it is used for nothing but
         * choosing which lock to wait on. Every decision below is made from the second read, taken
         * under both locks.
         *
         * An unknown token short-circuits here, so a caller presenting garbage never queues behind
         * anyone's lock — which also keeps the cheapest rejection the cheapest one. */
        UUID owner = repository.findUserIdByTokenHash(hash)
                .orElseThrow(() -> new UnauthorizedException("Invalid refresh token"));
        repository.lockFamily(familyKey(owner));

        /* Re-read under the lock. The row can legitimately be gone by now — `pruneExpired` deletes
         * expired rows, and a burn we were queued behind revokes rather than deletes, so that case
         * falls through to the revoked branch as it should. */
        RefreshToken current = repository.findByTokenHash(hash)
                .orElseThrow(() -> new UnauthorizedException("Invalid refresh token"));

        if (current.isRevoked()) {
            RefreshToken heir = liveHeirWithinGrace(current, Instant.now());
            if (heir != null && heir.getGracedCount() < MAX_CONSECUTIVE_GRACES) {
                // The one path that deliberately declines to trip the tripwire, so it is the one
                // most worth being able to see. Without this line the operator observes only the
                // eventual family burn -- which still happens, on the victim's next refresh, once
                // the heir has aged past the floor -- and cannot tell "two tabs raced, as designed"
                // from "somebody replayed a stolen token fifteen seconds ago". A rising rate is
                // either a client-side race regression or an attack; both are worth a look. User id
                // only: logging any part of the token would undo the reason it is hashed at rest.
                log.warn("Refresh replay forgiven inside the {} grace window for user {} "
                        + "(consecutive grace {} of {}) -- served from the family's live head "
                        + "instead of revoking the family",
                        grace, current.getUserId(), heir.getGracedCount() + 1,
                        MAX_CONSECUTIVE_GRACES);
                return mintSuccessor(heir, heir.getGracedCount() + 1);
            }
            if (heir != null) {
                // Fresh heir, but this chain has now been forgiven MAX_CONSECUTIVE_GRACES times in a
                // row with no uncontested rotation in between. An honest client does not do that --
                // it races once and then rotates cleanly -- so the benign reading has run out and
                // what is left is the reading the tripwire exists for. Distinct from the warn above
                // because this one is the security event: it is the moment forgiveness stops.
                log.warn("Refresh replay NOT forgiven for user {}: {} consecutive graces on one "
                        + "chain exceeds the limit of {} -- revoking the family",
                        current.getUserId(), heir.getGracedCount(), MAX_CONSECUTIVE_GRACES);
            }
            revokeAllForUser(current.getUserId());
            throw new UnauthorizedException("Invalid refresh token");
        }
        if (current.isExpired()) {
            throw new UnauthorizedException("Invalid refresh token");
        }

        // An uncontested rotation: the presented token was the live head, so nothing was racing for
        // it and the chain's grace count starts over. This reset is what keeps the limit above small
        // enough to be meaningful without ever reaching a client that is merely unlucky.
        return mintSuccessor(current, 0);
    }

    /**
     * The still-live token this spent one was rotated into, if that rotation happened inside the
     * grace window; null when it did not, when the chain ends, or when the head is unusable.
     *
     * <p>A row's {@code created_at} is when its predecessor was revoked — {@code mintSuccessor} does
     * both in one transaction — so the successor's own timestamp dates the rotation being forgiven.
     * That is why no {@code revoked_at} column is needed to answer this.
     */
    private RefreshToken liveHeirWithinGrace(RefreshToken spent, Instant now) {
        Instant floor = now.minus(grace);
        RefreshToken link = spent;
        for (int hop = 0; hop < MAX_GRACE_HOPS; hop++) {
            RefreshToken heir = repository.findByRotatedFrom(link.getId()).orElse(null);
            // No heir at all means the row was revoked by logout or by a family burn, not by a
            // rotation — nothing to forgive. Too old means the race story does not hold.
            if (heir == null || heir.getCreatedAt().isBefore(floor)) {
                return null;
            }
            if (!heir.isRevoked()) {
                return heir.isExpired() ? null : heir;
            }
            link = heir;
        }
        return null;
    }

    /**
     * Revoke {@code current} and chain a fresh token onto it. The one place a rotation happens.
     *
     * @param gracedCount consecutive graces ending at the new token — zero for an uncontested
     *                    rotation, the predecessor's plus one for a forgiven replay. Passed in
     *                    rather than derived here because only the caller knows which of the two
     *                    this is; {@code current} looks identical either way.
     */
    private Rotation mintSuccessor(RefreshToken current, int gracedCount) {
        current.revoke();
        String raw = Tokens.randomToken();
        repository.save(new RefreshToken(current.getUserId(), Tokens.sha256Hex(raw),
                current.getId(), Instant.now().plus(ttl), gracedCount));
        return new Rotation(current.getUserId(), raw);
    }

    /**
     * Revoke every refresh token for a user — the blunt "kill all sessions" primitive shared by
     * logout ({@code POST /auth/logout}) and the reuse-detection tripwire above.
     *
     * <p>Takes the family lock first, for both of the reasons on {@link
     * RefreshTokenRepository#lockFamily}. It is what stops a concurrent rotation from committing a
     * token this burn's snapshot never saw — the survivor of a burn is exactly the credential the
     * burn exists to destroy — and it is what stops two burns for one user from acquiring the
     * family's rows in opposite orders and deadlocking, which would abort one of them.
     *
     * <p>Re-entrant when {@code rotate} already holds it: an advisory lock is counted per
     * transaction, and all of it is released at commit or rollback.
     */
    @Transactional
    public void revokeAllForUser(UUID userId) {
        repository.lockFamily(familyKey(userId));
        repository.findByUserId(userId).forEach(RefreshToken::revoke);
    }

    /**
     * Fold a user id into the single {@code bigint} an advisory lock is keyed on.
     *
     * <p>XOR of the two halves rather than {@code hashCode()}, which is this same fold narrowed to
     * 32 bits and would throw away half the space for nothing. Collisions remain possible and remain
     * harmless — two unrelated families would occasionally serialise against each other — because
     * the key selects a lock and never identifies a row.
     */
    private static long familyKey(UUID userId) {
        return userId.getMostSignificantBits() ^ userId.getLeastSignificantBits();
    }

    /**
     * Remove already-expired refresh tokens to keep the table bounded (D10).
     *
     * @return number of rows deleted
     */
    @Transactional
    public long pruneExpired(Instant now) {
        return repository.deleteByExpiresAtBefore(now);
    }

    /** The outcome of a rotation: whose session it is, and the new raw refresh token. */
    public record Rotation(UUID userId, String refreshToken) {
    }
}
