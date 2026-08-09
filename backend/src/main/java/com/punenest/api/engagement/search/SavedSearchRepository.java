package com.punenest.api.engagement.search;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Persisted-search access. Queries are always user-scoped so no caller can see another's
 * saved searches (invariant 1). The {@code idx_saved_searches_user} index backs both finders.
 */
public interface SavedSearchRepository extends JpaRepository<SavedSearch, UUID> {

    /** The caller's saved searches, ordered by newest first. */
    List<SavedSearch> findByUserIdOrderByCreatedAtDesc(UUID userId);

    /** User-scoped single fetch — returns empty for another user's row (→ 404, never 403). */
    Optional<SavedSearch> findByIdAndUserId(UUID id, UUID userId);

    /** How many saved searches this user already holds — backs the per-user count cap on create. */
    long countByUserId(UUID userId);
}
