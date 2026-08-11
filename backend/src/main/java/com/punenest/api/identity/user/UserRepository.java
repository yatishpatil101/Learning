package com.punenest.api.identity.user;

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
 */
public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByMobile(String mobile);

    Optional<User> findByMobileAndArchivedFalse(String mobile);

    Optional<User> findByEmailAndArchivedFalse(String email);

        Optional<User> findByIdAndArchivedFalse(UUID id);

    boolean existsByMobile(String mobile);

    boolean existsByEmailAndArchivedFalse(String email);

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
     */
    @Query("""
            select u from User u
            where u.archived = :archived
              and (:role is null or u.role = :role)
              and (:prefix is null
                   or lower(u.name) like :prefix escape '\\'
                   or u.mobile like :prefix escape '\\')
            order by u.createdAt desc
            """)
    Page<User> searchForAdmin(@Param("role") String role,
            @Param("prefix") String prefix,
            @Param("archived") boolean archived,
            Pageable pageable);
}
