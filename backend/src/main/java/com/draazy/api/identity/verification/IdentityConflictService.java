package com.draazy.api.identity.verification;

import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.identity.user.UserRepository;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdentityConflictService {

    private static final Logger log = LoggerFactory.getLogger(IdentityConflictService.class);
    private static final int MAX_CONFLICTS_PER_DAY = 5;
    private static final Duration RECENT = Duration.ofHours(24);

    private final IdentityConflictRepository conflicts;
    private final IdentityVerificationRepository verifications;
    private final UserRepository users;
    private final EntityManager entityManager;
    private final Clock clock;

    public IdentityConflictService(IdentityConflictRepository conflicts,
            IdentityVerificationRepository verifications, UserRepository users,
            EntityManager entityManager, Clock clock) {
        this.conflicts = conflicts;
        this.verifications = verifications;
        this.users = users;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordOrRateLimit(UUID userId, String docType, String claimedHash,
            UUID holderVerificationId) {
        if (!users.existsById(userId) || !verifications.existsById(holderVerificationId)) {
            log.warn("Skipped identity conflict record because referenced rows are not committed");
            return;
        }
        lockUser(userId);
        Instant cutoff = Instant.now(clock).minus(RECENT);
        if (conflicts.countByUserIdAndCreatedAtAfter(userId, cutoff) >= MAX_CONFLICTS_PER_DAY) {
            throw new RateLimitedException(
                    "Too many identity conflicts. Try again after 24 hours.", (int) RECENT.toSeconds());
        }
        try {
            conflicts.saveAndFlush(new IdentityConflict(userId, docType, claimedHash, holderVerificationId));
        } catch (DataIntegrityViolationException e) {
            if (!isConflictForeignKeyViolation(e)) {
                throw e;
            }
            log.warn("Skipped identity conflict record because referenced rows are not committed");
        }
    }

    @Transactional(readOnly = true)
    public Optional<IdentityConflict> latestRecent(UUID userId) {
        return conflicts.findFirstByUserIdAndCreatedAtAfterOrderByCreatedAtDesc(
                userId, Instant.now(clock).minus(RECENT));
    }

    @Transactional
    public int deleteOlderThan(Duration ttl) {
        return conflicts.deleteByCreatedAtBefore(Instant.now(clock).minus(ttl));
    }

    private static boolean isConflictForeignKeyViolation(DataIntegrityViolationException e) {
        return e.getMostSpecificCause().getMessage() != null
                && e.getMostSpecificCause().getMessage().contains("identity_conflicts_")
                && e.getMostSpecificCause().getMessage().contains("_fkey");
    }

    private void lockUser(UUID userId) {
        entityManager.createNativeQuery(
                "select pg_advisory_xact_lock(hashtextextended(cast(:userId as text), 0))")
                .setParameter("userId", userId.toString())
                .getSingleResult();
    }
}
