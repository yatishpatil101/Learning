package com.draazy.api.deals.deal;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

// Excluding soft-deleted rows keeps these queries on the partial deal index.
public interface DealPartyRepository extends JpaRepository<DealParty, UUID> {

    @Query("select dp from DealParty dp where dp.dealId = :dealId and dp.deletedAt is null " +
            "order by dp.createdAt")
    List<DealParty> findLiveByDealId(@Param("dealId") UUID dealId);

    @Query("select dp from DealParty dp where dp.dealId in :dealIds and dp.deletedAt is null " +
            "order by dp.createdAt")
    List<DealParty> findLiveByDealIdIn(@Param("dealIds") Collection<UUID> dealIds);
}
