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
}
