package com.punenest.api.identity.user;

import com.punenest.api.security.RoleSource;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Users are never hard-deleted; callers that want only live users filter {@code archived = false}
 * (see {@link #findByMobileAndArchivedFalse}). Lookups by mobile/email back the login + uniqueness
 * checks.
 *
 * <p>Also satisfies {@link RoleSource}, the kernel's per-request view of one account's role (D201).
 * The abstraction lives in {@code security} and is implemented here for the same reason
 * {@code User implements TokenSubject}: the authorisation chain may not import a feature context,
 * and it does not need to — it wants one string.
 */
public interface UserRepository extends JpaRepository<User, UUID>, RoleSource {

    Optional<User> findByMobile(String mobile);

    Optional<User> findByMobileAndArchivedFalse(String mobile);

    /**
     * The batch form, for projections that hold a page of mobiles and would otherwise resolve them
     * one at a time. {@link com.punenest.api.billing.referral.ReferralMapper} is the caller.
     *
     * <p>Archived accounts are included: a projection over historical rows is describing who those
     * rows were about, and dropping the archived ones would silently turn a resolved row into an
     * unresolved one rather than into an accurate one.
     */
    List<User> findAllByMobileIn(Collection<String> mobiles);

    /**
     * The staff sign-in lookup, deliberately case-insensitive.
     *
     * <p>It has to be, because the write side is. {@code V02__DDL_identity_access.sql} indexes
     * {@code lower(email)} in {@code uq_users_live_email_ci} (added in the old V70), and the
     * uniqueness checks on {@code addStaff}/{@code update} match that with {@code IgnoreCase}. A
     * case-<em>sensitive</em> read against a case-insensitive write means
     * a colleague enrolled as {@code A.Sharma@…} is refused when they type {@code a.sharma@…} — an
     * address the platform will not let anybody else hold, and so an address that can only be
     * theirs. Refusing it authenticates nobody and locks out the owner.
     */
    Optional<User> findByEmailIgnoreCaseAndArchivedFalse(String email);

    Optional<User> findByIdAndArchivedFalse(UUID id);

    boolean existsByMobile(String mobile);

    /**
     * Is this email address already held by <em>any</em> live account?
     *
     * <p>Compared without regard to case, because V70's partial unique index is on
     * {@code lower(email)}: {@code A@x.com} and {@code a@x.com} conflict at the storage layer
     * whatever this method thinks. A case-sensitive guard did not prevent the duplicate, it only
     * decided which error the operator saw — a named 409 ("a user with that email already exists")
     * or the constraint handler's generic conflict, reached through a shift key.
     */
    boolean existsByEmailIgnoreCaseAndArchivedFalse(String email);

    /**
     * Is this email address already held by some <em>other</em> live account?
     *
     * <p>The question {@link #existsByEmailIgnoreCaseAndArchivedFalse} asks is nearly this one and
     * is not interchangeable with it, which is why both exist.
     *
     * <p><strong>Why the exclusion.</strong> The caller that needs this is
     * {@code moderation.user.UserAdminService#restore}, and the row it is about to bring back is
     * itself a candidate answer. Archiving is a soft delete, so a restored account is a row that
     * already exists; without {@code :excluding} a restore of a live account — which the endpoint
     * accepts today as a harmless repeat — would find itself and be refused, and the guard would
     * read as a bug rather than as a rule.
     *
     * <p><strong>Why case-insensitive.</strong> Because the database is. V70's partial unique index
     * is on {@code lower(email)}, so {@code A@x.com} and {@code a@x.com} conflict at the storage
     * layer whatever this method thinks. A guard that disagreed with the constraint standing behind
     * it would not prevent the conflict, only change which error the operator sees: a specific 409
     * naming the address and the way out, or the generic "that request conflicts with existing
     * data" the constraint handler produces. The sibling above now compares the same way.
     *
     * <p>Rows with a null email cannot match: {@code lower(null) = lower(:email)} is unknown, never
     * true. That is the wanted reading — an absent address is not a shared one — and it is the same
     * reading the partial index takes.
     */
    @Query("""
            select count(u) > 0 from User u
            where u.archived = false
              and u.id <> :excluding
              and lower(u.email) = lower(:email)
            """)
    boolean existsOtherLiveWithEmailIgnoreCase(@Param("email") String email,
            @Param("excluding") UUID excluding);

    /**
     * The role this account holds now — the {@link RoleSource} the bearer-token filter resolves on
     * every authenticated request (D201).
     *
     * <p>A scalar projection rather than {@code findById(id).map(User::getRole)} on purpose. This
     * runs before the request reaches a controller, so it must cost what it looks like it costs: one
     * indexed primary-key probe returning one short string, rather than hydrating a wide row and its
     * managed state into the persistence context to read one column off it.
     *
     * <p><strong>Archived accounts still answer with their role.</strong> The question here is
     * "which role", not "may this account still act" — those are different facts and conflating them
     * would quietly turn this into a session-revocation mechanism that nothing documents and no test
     * pins. Liveness is checked where it is decided, by {@code findByIdAndArchivedFalse} at the call
     * sites that care (D200).
     */
    @Override
    @Query("select u.role from User u where u.id = :id")
    Optional<String> roleOf(@Param("id") UUID id);

    /**
     * Every live account holding one role — used by the last-administrator floor (D200).
     *
     * <p>Unpaged on purpose. The only caller asks it about {@code admin}, a set whose size is the
     * number of people trusted with the back office, and it needs to inspect <em>all</em> of them to
     * answer "is there another one who could still hand access back". A page would answer that
     * question wrongly and silently the day the platform has more administrators than the page size.
     * Do not reuse it for {@code buyer}.
     */
    @Query("select u from User u where u.role = :role and u.archived = false")
    List<User> findLiveByRole(@Param("role") String role);

    /**
     * How many accounts hold this role, other than one — the bootstrap-escape predicate (D200).
     *
     * <p><strong>Archived accounts are counted deliberately</strong>, which is why this cannot be
     * expressed with {@link #findLiveByRole}. The question is "has this platform ever had a second
     * administrator", not "does it have one right now": an administrator who archives their peers
     * must not thereby re-open the escape that lets a newly minted account skip approval. See
     * {@code moderation.user.AdministratorGuard#approvalIsPossible}.
     */
    @Query("select count(u) from User u where u.role = :role and u.id <> :excluding")
    long countByRoleExcluding(@Param("role") String role, @Param("excluding") UUID excluding);

    /**
     * Back-office user search ({@code GET /users}).
     *
     * <p><strong>Prefix match, not substring, and that is a deliberate constraint rather than an
     * oversight.</strong> Only {@code pgcrypto} is installed — there is no {@code pg_trgm} — so a
     * leading-wildcard {@code %q%} could not be index-backed and would degrade to a sequential scan
     * over every user on the platform, on an endpoint any staff member can call. V18 adds
     * {@code text_pattern_ops} btree indexes on {@code lower(name)} and {@code mobile}, which serve
     * exactly this anchored form. Ops search by "the start of the name" or "the start of the
     * number", which is how people actually look someone up.
     *
     * <p>Nullable parameters are compared with {@code :x is null or …} so one query serves every
     * combination of filters without a Specification.
     *
     * <p>The {@code escape} clause is load-bearing, not decoration. The caller appends the trailing
     * {@code %}; without escaping, a search for {@code %} or {@code _} would smuggle the caller's own
     * wildcards past the anchor and produce precisely the unanchored, unindexed scan over every user
     * on the platform that this query is shaped to avoid — on an endpoint any staff member can call.
     *
     * <p>{@code status} and {@code flagged} are separate parameters from {@code archived} because
     * they are separate columns and a row may legitimately be both suspended and archived. Folding
     * them into one "state" filter would make the directory unable to express "suspended accounts
     * I have not yet removed", which is the queue a moderator actually works.
     */
    @Query("""
            select u from User u
            where u.archived = :archived
              and (:role is null or u.role = :role)
              and (:status is null or u.status = :status)
              and (:flagged is null or u.flagged = :flagged)
              and (:prefix is null
                   or lower(u.name) like :prefix escape '\\'
                   or u.mobile like :prefix escape '\\')
            order by u.createdAt desc
            """)
    Page<User> searchForAdmin(@Param("role") String role,
            @Param("prefix") String prefix,
            @Param("status") String status,
            @Param("flagged") Boolean flagged,
            @Param("archived") boolean archived,
            Pageable pageable);
}
