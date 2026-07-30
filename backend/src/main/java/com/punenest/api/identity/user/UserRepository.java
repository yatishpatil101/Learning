package com.punenest.api.identity.user;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Users are never hard-deleted; callers that want only live users filter {@code archived = false}
 * (see {@link #findByMobileAndArchivedFalse}). Lookups by mobile/email back the login + uniqueness
 * checks.
 */
public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByMobile(String mobile);

    Optional<User> findByMobileAndArchivedFalse(String mobile);

    Optional<User> findByEmailAndArchivedFalse(String email);

    boolean existsByMobile(String mobile);
}
