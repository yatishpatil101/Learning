package com.draazy.api.services.request;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

// Every finder is scoped by request, user, or pending mobile.
// There is deliberately no bare role/status lookup.
public interface ServiceRequestPartyRepository extends JpaRepository<ServiceRequestParty, UUID> {

    List<ServiceRequestParty> findByRequestIdOrderByRoleAscPartyIndexAscCreatedAtAsc(UUID requestId);

    default List<ServiceRequestParty> findByRequestId(UUID requestId) {
        return findByRequestIdOrderByRoleAscPartyIndexAscCreatedAtAsc(requestId);
    }

    List<ServiceRequestParty> findByRequestIdIn(List<UUID> requestIds);

    List<ServiceRequestParty> findByUserIdAndStatusOrderByCreatedAtDesc(UUID userId, String status);

    boolean existsByRequestIdAndStatus(UUID requestId, String status);

    long countByRequestIdAndStatus(UUID requestId, String status);

    boolean existsByRequestIdAndUserIdAndStatus(UUID requestId, UUID userId, String status);

    // The one row that decides whether this person may be invited onto this request at all.
    // Read only for a better message; the unique index holds the rule.
    boolean existsByRequestIdAndUserId(UUID requestId, UUID userId);

    // Mobile is the only scope before an account exists.
    // CoFillParties calls this with the caller's verified number.
    List<ServiceRequestParty> findByMobile(String mobile);

    boolean existsByRequestIdAndMobile(UUID requestId, String mobile);

    boolean existsByRequestIdAndRoleAndPartyIndex(UUID requestId, String role, int partyIndex);

    // Expired pending invite rows have no useful remainder once timeline records the send.
    long deleteByInviteExpiresAtBefore(Instant cutoff);
}
