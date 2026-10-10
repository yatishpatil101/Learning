package com.draazy.api.billing.referral;

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

    /** Locked as approve, reject and clawback are check-then-act on {@code status}: unlocked, two checkers
     * would both release and audit the reward; locked, the second gets the 409. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Referral r where r.id = :id")
    Optional<Referral> findForDecision(@Param("id") UUID id);

    /** Ops queue via null-tolerant predicates in one query, not a {@code Specification}, so the planner keeps
     * its options; {@code statuses} is never empty, {@code anyStatus} says to ignore it. */
    @Query("""
            select r from Referral r
            where (:anyStatus = true or r.status in :statuses)
              and (:risk is null or r.risk = :risk)
              and (:q is null
                   or lower(r.referred) like :q
                   or r.referrerMobile like :q
                   or r.referredMobile like :q
                   or lower(cast(r.id as string)) like :q
                   or r.referrerId in (select u.id from User u where lower(u.name) like :q))
            order by r.at desc
            """)
    Page<Referral> queue(@Param("anyStatus") boolean anyStatus, @Param("statuses") List<String> statuses,
            @Param("risk") String risk, @Param("q") String q, Pageable pageable);

    /** The desk's tab totals over the whole table: all, pending (open), high risk, rewarded, refused. */
    @Query("""
            select count(r),
                   coalesce(sum(case when r.status in ('pending', 'qualified') then 1 else 0 end), 0),
                   coalesce(sum(case when r.risk = 'high' then 1 else 0 end), 0),
                   coalesce(sum(case when r.status = 'rewarded' then 1 else 0 end), 0),
                   coalesce(sum(case when r.status in ('rejected', 'clawed-back') then 1 else 0 end), 0)
            from Referral r
            """)
    List<Object[]> tabCounts();

    /** Everything one referrer has brought in. Serves {@code idx_referrals_referrer_status} (V23). */
    List<Referral> findByReferrerId(UUID referrerId);

    /** Backed by the unique index {@code uq_referrals_referred_mobile}, which is what actually enforces it. */
    boolean existsByReferredMobile(String referredMobile);

    /** Counts rows regardless of outcome: a referrer whose last twenty referrals were all rejected
     * is exactly who this velocity signal is for. */
    long countByReferrerIdAndAtAfter(UUID referrerId, Instant since);

    /** Row-locked so qualification is idempotent: a retried write or second listing announces twice, and
     * both would read {@code pending}. Locking only {@code pending} rows keeps the fraud desk from waiting. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Referral r where r.referredMobile = :mobile and r.status = 'pending'")
    Optional<Referral> findPendingForQualification(@Param("mobile") String mobile);

    /** Counts qualifications, not redemptions, because the cap bounds what is minted automatically. */
    long countByReferrerIdAndQualifiedAtAfter(UUID referrerId, Instant since);

    /** This count is the entitlement: a stored counter would need un-incrementing on clawback. Status alone, not
     * {@code qualified_at}: desk-approved referrals are {@code rewarded} with a null stamp and must still earn. */
    @Query("""
            select count(r) from Referral r
            where r.referrerId = :referrerId
              and r.status in ('qualified', 'rewarded')
            """)
    long countGrantingFor(@Param("referrerId") UUID referrerId);

    /** Bulk update, so retention never loads unbounded rows; leaves {@code updated_at} alone as expiry is no edit,
     * and the {@code is not null} guard stops every tick rewriting null over null. */
    @Modifying
    @Query("""
            update Referral r
               set r.referredIpHash = null, r.referredDeviceHash = null
             where r.at < :cutoff
               and (r.referredIpHash is not null or r.referredDeviceHash is not null)
            """)
    int clearSignalsOlderThan(@Param("cutoff") Instant cutoff);
}
