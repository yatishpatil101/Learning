package com.draazy.api.services.request;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

// Every finder is scoped to one request.
// No bulk identity-number reads from this table.
public interface ServiceRequestIdentityRepository extends JpaRepository<ServiceRequestIdentity, UUID> {

    List<ServiceRequestIdentity> findByServiceRequestIdOrderByPartyRoleAscPartyIndexAsc(
            UUID serviceRequestId);

    // Replace writes delete first so corrected parties do not leave old numbers behind.
    // Scoped to roles so a co-filled tenant side survives the requester's resubmission of theirs.
    void deleteByServiceRequestIdAndPartyRoleIn(UUID serviceRequestId, Collection<String> partyRoles);

    @Modifying
    void deleteByServiceRequestIdAndPartyRoleAndPartyIndexIn(UUID serviceRequestId,
            String partyRole, Collection<Integer> partyIndexes);

    String PAST_RETENTION = """
            from ServiceRequestIdentity i, ServiceRequest r
            where r.id = i.serviceRequestId
              and i.purgedAt is null
              and r.status not in (com.draazy.api.services.request.ServiceRequestStatus.COMPLETED,
                                   com.draazy.api.services.request.ServiceRequestStatus.CANCELLED)
              and ((r.updatedAt < :idleSince
                    and not exists (select 1 from ServiceRequestIdentity j
                                    where j.serviceRequestId = r.id and j.createdAt >= :idleSince))
                   or i.createdAt < :heldSince)
            """;

    @Query("select distinct i.serviceRequestId " + PAST_RETENTION)
    List<UUID> findOpenRequestIdsHoldingNumbersPast(@Param("idleSince") Instant idleSince,
            @Param("heldSince") Instant heldSince);

    @Query("select count(i) > 0 " + PAST_RETENTION + " and r.id = :id")
    boolean isPastRetention(@Param("id") UUID id, @Param("idleSince") Instant idleSince,
            @Param("heldSince") Instant heldSince);
}
