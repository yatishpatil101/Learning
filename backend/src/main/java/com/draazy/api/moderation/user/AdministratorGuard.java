package com.draazy.api.moderation.user;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import jakarta.persistence.EntityManager;
import jakarta.persistence.FlushModeType;
import jakarta.persistence.Query;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The last-administrator floor: no operation may leave the platform with no live administrator
 * (tech debt D200). The administrator is never narrowed ({@code AccountPermissions#effectiveFor}),
 * so "capable" is simply role {@code admin} and not archived.
 *
 * <p>Guarded: archive ({@code UserAdminService#archive}). There is no role-change route; when one
 * lands it must call {@link #refuseIfLastAdministrator}.
 *
 * <p><strong>Erasure is not guarded, and that is a decision.</strong> Refusing a statutory DPDP
 * s.12(3) erasure on operational grounds is not available to us; erasing the last administrator is
 * an accepted, loud, self-service event, recoverable through {@code BOOTSTRAP_ADMIN_RECOVER}.
 *
 * <p>409 rather than 403: the caller may perform the operation; the platform's state forbids it.
 */
@Component
public class AdministratorGuard {

    /**
     * The advisory-lock key for the whole floor. One constant, not one per account, deliberately.
     *
     * <p>Without it the guard is check-then-act under READ COMMITTED, and the failure it misses is
     * the one an attacker would reach for: two administrators archiving <em>each other</em> at the
     * same moment each read a platform that still has two, and both writes commit. A key derived
     * from the account being changed would not help, because the two transactions name different
     * accounts — what has to be serialised is the invariant, and the invariant is global.
     *
     * <p>Serialising every back-office lockout-adjacent write against every other one costs nothing
     * here: these operations happen a handful of times in the life of a company.
     */
    private static final long FLOOR_LOCK = 0xD200L;

    private final UserRepository users;
    private final EntityManager em;

    public AdministratorGuard(UserRepository users, EntityManager em) {
        this.users = users;
        this.em = em;
    }

    /**
     * Refuse an operation that would end {@code target}'s ability to administer the platform, when
     * nobody else can.
     *
     * <p>Takes the account rather than the operation on purpose: archive, demotion and any future
     * deactivation all reduce to "this account stops counting", so they share one guard and cannot
     * drift apart. An operation on an account that was never capable is a no-op here — narrowing a
     * moderator or archiving a buyer has nothing to do with the floor.
     *
     * @throws ConflictException 409, naming the repair, when {@code target} is the last capable
     *                           administrator
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void refuseIfLastAdministrator(User target) {
        if (!Roles.Wire.ADMIN.equals(target.getRole())) {
            return;
        }
        holdFloorUntilCommit();
        if (!isCapable(target) || anotherCapableAdministratorExists(target.getId())) {
            return;
        }
        throw new ConflictException(
                "This is the last active administrator. "
                        + "Appoint another administrator first, "
                        + "otherwise nobody would be able to hand access back.");
    }

    /**
     * Serialise this transaction against every other floor-guarded write, until it commits.
     *
     * <p>{@code Propagation.MANDATORY} on the callers is what makes this mean anything: a
     * transaction-scoped advisory lock taken outside a transaction runs in its own autocommit and is
     * released before the caller reads, which is a fail-open with no symptom. The one native query
     * mirrors {@code common.persistence.RateLimitLock} rather than reusing it — that class is named
     * for, and namespaced by, rate limits, and borrowing it would put a lock about administrator
     * lockout inside an enum of counters.
     */
    private void holdFloorUntilCommit() {
        Query query = em.createNativeQuery(
                // pg_advisory_xact_lock returns void, which no result-set mapping can name, so it is
                // called in a subquery whose column is never selected.
                "select 1 from (select pg_advisory_xact_lock(:lockId)) as acquired");
        query.setFlushMode(FlushModeType.COMMIT);
        query.setParameter("lockId", FLOOR_LOCK);
        query.getSingleResult();
    }

    /** Somebody other than {@code excluding} who could still hand access back. */
    private boolean anotherCapableAdministratorExists(UUID excluding) {
        return users.findLiveByRole(Roles.Wire.ADMIN).stream()
                .filter(candidate -> !candidate.getId().equals(excluding))
                .anyMatch(this::isCapable);
    }

    private boolean isCapable(User candidate) {
        return Roles.Wire.ADMIN.equals(candidate.getRole()) && !candidate.isArchived();
    }
}
