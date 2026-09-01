package com.punenest.api.services.request;

import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Deletes co-fill invitations that were never claimed — the retention policy for the one column in
 * {@code service_request_parties} that holds personal data (V107).
 *
 * <p><strong>Why this table needs a sweep when the rest of the aggregate does not.</strong> Every
 * other piece of personal data on a service request belongs to somebody with an account, and an
 * account is a thing that can ask for erasure. A pending invitation is the opposite: a mobile number
 * supplied by <em>one</em> person about <em>another</em>, who by construction has never registered,
 * has never been told the number is here, and has no way to ask us for anything. Nobody will ever
 * come and clear it, so it has to clear itself.
 *
 * <p><strong>And it is not only a privacy clock.</strong> TRAI releases a disconnected mobile back
 * into the pool after ninety days. An invitation older than that could be claimed by a stranger who
 * merely inherited the number — {@code CoFillParties.claimPendingFor} would bind them to somebody
 * else's rent agreement on a proof that was true when the invitation was written and is not any
 * more. The claim path refuses expired rows for exactly this reason; this sweep is what stops them
 * accumulating, and the two together are the whole of the recycled-number answer.
 *
 * <p><strong>Its own class rather than a method on {@link CoFillParties},</strong> following the
 * split this codebase already uses for {@code ReferralSignalRetention} and {@code PageViewRetention}:
 * the policy — the window, and the statement that enforces it — is one thing, and the schedule that
 * fires it is another. See {@link CoFillInviteRetentionSweep} for the trigger.
 *
 * <p>Deleting rather than blanking, unlike the referral sweep. There is no remainder worth keeping:
 * strip the number from a pending row and what is left is a role on a matter nobody joined, and the
 * request's own timeline already records that an invitation was sent.
 */
@Service
public class CoFillInviteRetention {

    /** The window, stated once. {@link CoFillParties#PENDING_INVITE_TTL} is where it is set. */
    public static final Duration RETENTION = CoFillParties.PENDING_INVITE_TTL;

    private static final Logger log = LoggerFactory.getLogger(CoFillInviteRetention.class);

    private final ServiceRequestPartyRepository parties;

    CoFillInviteRetention(ServiceRequestPartyRepository parties) {
        this.parties = parties;
    }

    /**
     * Expire everything past its clock.
     *
     * <p><strong>Annotated in its own right, and that is load-bearing.</strong> This method
     * self-invokes {@link #expireInvitesOlderThan}, and a self-invocation never crosses the Spring
     * proxy — so a {@code @Transactional} on the inner method alone would leave this one running
     * without a transaction and throwing {@code InvalidDataAccessApiUsageException} on every tick.
     * {@code ReferralSignalRetention} shipped exactly that defect and its ninety-day expiry never
     * ran once; the annotation here is the fix already learned.
     *
     * @return how many invitations were deleted
     */
    @Transactional
    public long expireNow() {
        return expireInvitesOlderThan(Instant.now());
    }

    /**
     * Expire against a caller-chosen cutoff. Separate from {@link #expireNow()} so a test can prove
     * the row-level behaviour without waiting ninety days or mutating the clock.
     */
    @Transactional
    public long expireInvitesOlderThan(Instant cutoff) {
        long deleted = parties.deleteByInviteExpiresAtBefore(cutoff);
        if (deleted > 0) {
            log.info("Expired {} unclaimed co-fill invitation(s) older than {}", deleted, cutoff);
        }
        return deleted;
    }
}
