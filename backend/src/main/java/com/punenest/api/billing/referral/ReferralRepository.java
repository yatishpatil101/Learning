package com.punenest.api.billing.referral;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** The ops review queue, the referrer's own summary, and the two anti-abuse probes. */
public interface ReferralRepository extends JpaRepository<Referral, UUID> {

    /**
     * Load a referral for a checker's decision, holding a row lock until the transaction commits.
     *
     * <p>Approve, reject and clawback are all check-then-act on {@code status}. Two checkers acting
     * on the same referral at the same moment would both read a decidable state, both write, and
     * both file an audit entry — leaving the desk's own record claiming the reward was released
     * twice. The lock makes the read and the write one step, so the second checker sees the first
     * one's decision and gets the 409 they should.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Referral r where r.id = :id")
    Optional<Referral> findForDecision(@Param("id") UUID id);

    /**
     * The ops queue: optional status and risk facets, newest first. Serves
     * {@code idx_referrals_queue} (V23).
     *
     * <p>A single JPQL query with null-tolerant predicates rather than a {@code Specification}: two
     * equality facets do not justify the machinery, and the null checks keep the query planner's
     * options open instead of building four different statements.
     */
    @Query("""
            select r from Referral r
            where (:status is null or r.status = :status)
              and (:risk is null or r.risk = :risk)
            order by r.at desc
            """)
    Page<Referral> queue(@Param("status") String status, @Param("risk") String risk,
            Pageable pageable);

    /** Everything one referrer has brought in. Serves {@code idx_referrals_referrer_status} (V23). */
    List<Referral> findByReferrerId(UUID referrerId);

    /**
     * Whether this person has already been referred by anyone. Backed by the unique index
     * {@code uq_referrals_referred_mobile} (V23), which is what actually enforces it.
     */
    boolean existsByReferredMobile(String referredMobile);

    /**
     * How many referrals this referrer has redeemed since {@code since} — the velocity signal.
     *
     * <p>Counts rows regardless of outcome on purpose: a referrer whose last twenty referrals were
     * all rejected is exactly who this signal is for.
     */
    long countByReferrerIdAndAtAfter(UUID referrerId, Instant since);

    /**
     * The one referral this person's activation could qualify, held under a row lock (Q17).
     *
     * <p>Keyed on the mobile because that is what {@code referrals} stores — there is no
     * {@code referred_id} column, and {@code uq_referrals_referred_mobile} (V23) guarantees at most
     * one row comes back, so this is a lookup rather than a search.
     *
     * <p><strong>The lock is what makes qualification idempotent.</strong> Ownership verification
     * announces inside the verifying transaction, so a retried write announces again, and an owner
     * who publishes two listings announces twice. Both races read {@code status = 'pending'}, both
     * would qualify, and the referrer would collect twice for one referee. Locking the row turns the
     * read and the write into one step, so the second caller sees {@code qualified} and does
     * nothing. Restricting to {@code pending} in the query as well means an already-decided referral
     * is not even locked — a fraud desk deciding a case must not be made to wait behind an unrelated
     * property verification.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Referral r where r.referredMobile = :mobile and r.status = 'pending'")
    Optional<Referral> findPendingForQualification(@Param("mobile") String mobile);

    /**
     * How many of this referrer's referrals have qualified since {@code since} — the D61 cap.
     *
     * <p>Counts qualifications rather than redemptions, because the cap exists to bound what can be
     * <em>minted</em> automatically. Serves {@code idx_referrals_referrer_qualified} (V64).
     */
    long countByReferrerIdAndQualifiedAtAfter(UUID referrerId, Instant since);

    /**
     * How many of this referrer's referrals have earned their owner-contact grant (D31b).
     *
     * <p>This count <em>is</em> the entitlement. There is no balance column and no grant ledger:
     * multiplying this by {@code settings.fees.referralContactBonus} gives the referrer's bonus
     * every time it is asked for, so the number cannot drift from the referrals that justify it.
     * The alternative — a stored counter incremented on qualification — has to be un-incremented on
     * clawback by whoever remembers, and is wrong forever if anybody forgets.
     *
     * <p><strong>Status alone, deliberately not {@code qualified_at is not null} as well.</strong>
     * That extra condition looks like a harmless belt-and-braces check and silently halves the
     * scheme: {@code qualified_at} is stamped only by Q17's automatic path, so a referral a human
     * approved at the fraud desk is {@code rewarded} with a null timestamp and would earn nothing.
     * The two ways a referral can pay are the two statuses in
     * {@link ReferralStatuses#isGranting}, and this query must agree with that set and nothing else.
     */
    @Query("""
            select count(r) from Referral r
            where r.referrerId = :referrerId
              and r.status in ('qualified', 'rewarded')
            """)
    long countGrantingFor(@Param("referrerId") UUID referrerId);

    /**
     * Blank the referee-side correlation digests on rows past their retention window (D55).
     *
     * <p>A bulk update rather than a load-mutate-flush: this touches rows nobody is looking at and
     * loading them would be an unbounded read for a job whose whole output is two nulls. It
     * deliberately leaves {@code updated_at} alone — dropping evidence at the end of its retention
     * period is not an edit to the referral, and bumping the timestamp would make every row look
     * freshly touched to anyone auditing the queue.
     *
     * <p>The {@code is not null} guard is what keeps the job cheap: without it every tick would
     * rewrite the entire historical table to set null over null.
     */
    @Modifying
    @Query("""
            update Referral r
               set r.referredIpHash = null, r.referredDeviceHash = null
             where r.at < :cutoff
               and (r.referredIpHash is not null or r.referredDeviceHash is not null)
            """)
    int clearSignalsOlderThan(@Param("cutoff") Instant cutoff);
}
