package com.punenest.api.engagement.history;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The signed-in user's recent-search rail (V121). Every query is keyed by {@code userId}; there is
 * deliberately no find-by-id, so no read here can be made to cross accounts by passing a guessed
 * identifier.
 */
interface RecentSearchRepository extends JpaRepository<RecentSearch, UUID> {

    List<RecentSearch> findByUserIdOrderBySearchedAtDesc(UUID userId, Limit limit);

    /** All of them, newest first — the eviction pass needs to see past the cap to find the losers. */
    List<RecentSearch> findByUserIdOrderBySearchedAtDesc(UUID userId);

    Optional<RecentSearch> findByUserIdAndUrl(UUID userId, String url);
}
