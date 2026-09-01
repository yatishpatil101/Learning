package com.draazy.api.moderation.user;

import com.draazy.api.common.access.StaffAccountApprovalRepository;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import jakarta.persistence.EntityManager;
import jakarta.persistence.FlushModeType;
import jakarta.persistence.Query;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The last-administrator floor: no back-office operation may leave the platform with nobody able to
 * hand access back (tech debt D200, half 1).
 *
 * <h2>What "administrator" means here, and why it is the capability rather than the role</h2>
 *
 * <p>An administrator, for the purpose of this guard, is an account that is <strong>role
 * {@code admin}, not archived, not awaiting maker-checker approval, and still holding
 * {@link BackOfficePermissions#USERS_WRITE} once its permission document has been applied</strong>.
 * The role alone is deliberately <em>not</em> enough.
 *
 * <p>The reason is that the floor exists to keep one property true — <em>somebody can still repair
 * this</em> — and the role does not carry that property. D192 made narrowing real, so an account may
 * be {@code role = admin} and scoped down to {@code tickets:read}; it cannot create a colleague, it
 * cannot archive or restore anyone, and it cannot edit a permission document, because every one of
 * those routes is {@code users:write}. Counting it would let this guard report "there is still an
 * administrator" about a platform that is already locked out of its own back office — a guard that
 * passes precisely when the disaster has happened. The archived and awaiting-approval exclusions are
 * the same argument: an account that cannot obtain a token cannot repair anything either, and the
 * awaiting-approval case is not hypothetical, since half 2 of D200 creates exactly those accounts.
 *
 * <p>Choosing the capability is also strictly the <em>safer</em> reading rather than merely a
 * different one. {@code users:write} is declared {@code adminOnly} in the catalogue, so
 * {@link BackOfficePermissions#baselineFor(String)} puts it out of reach of every staff account and
 * the intersection in {@link AccountPermissions} drops it from any staff document that names it.
 * Capability therefore <em>implies</em> the role: the capable set is a subset of the admin-role set,
 * never a superset, so this definition can only ever refuse operations the role-based one would have
 * allowed. It never permits one the role-based reading would have caught.
 *
 * <h2>What is guarded, and one thing that deliberately is not</h2>
 *
 * <ul>
 *   <li><strong>Archive</strong> — {@code UserAdminService#archive}. Self-archive was already
 *       refused; peer archive was not, which is how D200 records that "the same account can also
 *       remove the person who narrowed it".</li>
 *   <li><strong>Permission narrowing</strong> — {@code BackOfficeAccessService#replace}, when the
 *       replacement document would take {@code users:write} away from the last capable
 *       administrator. Narrowing is the quieter half of the same lockout: it leaves an account that
 *       still says {@code admin} on every screen and can no longer restore anybody.</li>
 *   <li><strong>Role demotion</strong> — <em>there is no route that changes a user's role.</em>
 *       {@code PATCH /users/{id}} carries name, email and avatar only, and a repository-wide search
 *       for {@code setRole(} finds no call site outside account creation. D201 describes demotion as
 *       a gesture the console offers; the server does not implement it. When it lands it must call
 *       {@link #refuseIfLastAdministrator}, which is why that method takes the account rather than
 *       the operation — demotion, archive and erasure all reduce to the same question.</li>
 * </ul>
 *
 * <p><strong>Erasure is not guarded, and that is a decision.</strong>
 * {@code identity.user.erasure} archives the account it de-identifies, so a sole administrator
 * exercising their DPDP s.12(3) right can still empty the back office. Refusing a statutory erasure
 * on operational grounds is not available to us, and a guard that could be satisfied by first
 * appointing a colleague is advice, not a control. The honest answer is that erasure of the last
 * administrator is an accepted, loud, self-service event rather than a hostile one.
 *
 * <h2>Why 409 and not 403</h2>
 *
 * <p>403 says "you may not do this", which is false: the caller holds {@code users:write} and this
 * is exactly the route it exists for. What is wrong is the <em>state of the platform</em> — the
 * request would be fine tomorrow, once a second administrator exists. That is what 409 means, and
 * the message names the repair rather than the refusal, because an operator who is told only "no"
 * during an incident goes to the database.
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
    private final AccountPermissions accountPermissions;
    private final StaffAccountApprovalRepository approvals;
    private final EntityManager em;

    public AdministratorGuard(UserRepository users, AccountPermissions accountPermissions,
            StaffAccountApprovalRepository approvals, EntityManager em) {
        this.users = users;
        this.accountPermissions = accountPermissions;
        this.approvals = approvals;
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
                "This is the last administrator who can still manage back-office access. "
                        + "Give another active administrator the users:write permission first, "
                        + "otherwise nobody would be able to hand access back.");
    }

    /**
     * Refuse a permission document that would take {@code users:write} away from the last capable
     * administrator.
     *
     * <p>Separate from {@link #refuseIfLastAdministrator} because the account survives this
     * operation and the question is about the <em>replacement</em>, not about the row as it stands.
     * The replacement is checked before it is written, so a refusal leaves the stored document
     * untouched — a caller who is told 409 has changed nothing and can resend.
     *
     * @param target      the account whose document is being replaced
     * @param replacement the atoms about to be stored, before intersection with the baseline;
     *                    {@code users:write} being absent is what makes this dangerous
     * @throws ConflictException 409 when the replacement would empty the platform of administrators
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void refuseIfNarrowingRemovesLastAdministrator(User target, Set<String> replacement) {
        if (replacement.contains(BackOfficePermissions.USERS_WRITE)
                || !Roles.Wire.ADMIN.equals(target.getRole())) {
            return;
        }
        holdFloorUntilCommit();
        if (!isCapable(target) || anotherCapableAdministratorExists(target.getId())) {
            return;
        }
        throw new ConflictException(
                "This is the last administrator who can still manage back-office access, so "
                        + "users:write cannot be taken away from it. Give another active "
                        + "administrator that permission first, then narrow this one.");
    }

    /**
     * Is there anybody who could ever approve an account this administrator creates?
     *
     * <p>The bootstrap-escape predicate for half 2, and the one place where the counted set is
     * deliberately <strong>wider</strong> than {@link #isCapable}: it counts every account with the
     * {@code admin} role, <em>archived ones included</em>, and only excludes the creator.
     *
     * <p>The width is the whole point. The narrow reading — "is there another administrator who
     * could approve right now" — hands the attacker the escape: an administrator holding
     * {@code users:write} archives their peers one at a time (each archive is individually
     * authorised and the floor above permits it until the last one), becomes the sole capable
     * administrator, and the platform then auto-approves whatever they mint next. Counting archived
     * accounts closes that, because archiving somebody does not un-create them; the escape is
     * available on a platform that has <em>never had</em> a second administrator, which is the only
     * situation it was meant for.
     *
     * <p>The cost is one operational trap, and it has an in-product remedy: a platform whose only
     * other administrator was archived long ago will create accounts that need an approval only that
     * archived account could give. {@code PATCH /users/{id}/restore} is the way out, it is on the
     * same {@code users:write} atom the creator already holds, and it is a better outcome than the
     * alternative — an auto-approval that an attacker can manufacture.
     *
     * <p><strong>Call this before inserting the new account, not after.</strong> The count matches
     * {@code role = 'admin'} and excludes only the creator, so an already-flushed new administrator
     * counts itself and the escape can never fire for the role it exists for — a lone founder's
     * first admin colleague comes back held, approvable by nobody. The original implementation had
     * this order wrong and looked correct, because the escape still fires for {@code role=staff},
     * which the predicate does not match. Fixed 2026-08-11; see {@code UserAdminService#addStaff}.
     *
     * @param creatorId the administrator about to mint an account; never counts towards their own
     *                  approval, since the checker may not be the maker
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean approvalIsPossible(UUID creatorId) {
        return users.countByRoleExcluding(Roles.Wire.ADMIN, creatorId) > 0;
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

    /**
     * The definition this whole class turns on — see the class Javadoc for why it is the capability
     * and not the role.
     */
    private boolean isCapable(User candidate) {
        return Roles.Wire.ADMIN.equals(candidate.getRole())
                && !candidate.isArchived()
                && !approvals.existsByUserIdAndApprovedAtIsNull(candidate.getId())
                && accountPermissions.effectiveFor(candidate.getRole(), candidate.getId())
                        .contains(BackOfficePermissions.USERS_WRITE);
    }
}
