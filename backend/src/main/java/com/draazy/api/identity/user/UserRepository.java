package com.draazy.api.identity.user;

import com.draazy.api.security.RoleSource;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

// Users are never hard-deleted; live lookups must filter archived = false.
public interface UserRepository extends JpaRepository<User, UUID>, RoleSource {

    Optional<User> findByMobile(String mobile);

    Optional<User> findByMobileAndArchivedFalse(String mobile);

    // Batch form avoids resolving a page of mobiles one at a time.
    List<User> findAllByMobileIn(Collection<String> mobiles);

    // The staff sign-in lookup, deliberately case-insensitive. It has to be, because the write side is.
    Optional<User> findByEmailIgnoreCaseAndArchivedFalse(String email);

    Optional<User> findByIdAndArchivedFalse(UUID id);

    boolean existsByMobile(String mobile);

    // Case-insensitive because the partial unique index is on lower(email); a guard that disagrees
    // only changes which conflict the operator sees.
    boolean existsByEmailIgnoreCaseAndArchivedFalse(String email);

    // Excludes the row being restored: archived accounts already exist, so a repeat restore would
    // otherwise find itself and be refused.
    @Query("""
            select count(u) > 0 from User u
            where u.archived = false
              and u.id <> :excluding
              and lower(u.email) = lower(:email)
            """)
    boolean existsOtherLiveWithEmailIgnoreCase(@Param("email") String email,
            @Param("excluding") UUID excluding);

    // Scalar projection because the bearer-token filter needs only the current role.
    @Override
    @Query("select u.role from User u where u.id = :id")
    Optional<String> roleOf(@Param("id") UUID id);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update User u set u.lastActive = :now
            where u.id = :id and (u.lastActive is null or u.lastActive < :cutoff)
            """)
    int touchLastActive(@Param("id") UUID id, @Param("now") java.time.Instant now,
            @Param("cutoff") java.time.Instant cutoff);

    // Unpaged on purpose: used only by the last-administrator floor.
    @Query("select u from User u where u.role = :role and u.archived = false")
    List<User> findLiveByRole(@Param("role") String role);

    // Unpaged on purpose: every admin, manager and staff account, live and archived, is one roster.
    @Query("select u from User u where u.role in ('admin', 'manager', 'staff') order by u.createdAt desc")
    List<User> findBackOfficeAccounts();

    // Prefix match is deliberate: the directory is not a broad substring search.
    @Query("""
            select u from User u
            where u.archived = :archived
              and (:role is null or u.role = :role)
              and (:customers = false or u.role in ('owner', 'buyer'))
              and (:status is null or u.status = :status)
              and (:flagged is null or u.flagged = :flagged)
              and (:prefix is null
                   or lower(u.name) like :prefix escape '\\'
                   or u.mobile like :prefix escape '\\')
            order by u.createdAt desc
            """)
    Page<User> searchForAdmin(@Param("role") String role,
            @Param("customers") boolean customers,
            @Param("prefix") String prefix,
            @Param("status") String status,
            @Param("flagged") Boolean flagged,
            @Param("archived") boolean archived,
            Pageable pageable);

    // Same predicates as searchForAdmin minus archived/status/flagged, so the tab counts group over one scan.
    @Query("""
            select u.archived, u.status, count(u) from User u
            where (:role is null or u.role = :role)
              and (:customers = false or u.role in ('owner', 'buyer'))
              and (:prefix is null
                   or lower(u.name) like :prefix escape '\\'
                   or u.mobile like :prefix escape '\\')
            group by u.archived, u.status
            """)
    List<Object[]> countByStanding(@Param("role") String role,
            @Param("customers") boolean customers, @Param("prefix") String prefix);
}
