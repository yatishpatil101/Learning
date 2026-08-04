package com.punenest.api.deals.deal;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Access to {@code deal_parties}. Every query excludes soft-deleted rows
 * ({@code deleted_at IS NULL}) so it can use the partial index
 * {@code idx_deal_parties_deal}.
 */
public interface DealPartyRepository extends JpaRepository<DealParty, UUID> {

    /** Live parties for one deal, chronological. */
    @Query("select dp from DealParty dp where dp.dealId = :dealId and dp.deletedAt is null " +
            "order by dp.createdAt")
    List<DealParty> findLiveByDealId(@Param("dealId") UUID dealId);

    /** One live party by id and deal — the scoping check for remove. */
    @Query("select dp from DealParty dp where dp.id = :id and dp.dealId = :dealId " +
            "and dp.deletedAt is null")
    Optional<DealParty> findLiveByIdAndDealId(@Param("id") UUID id, @Param("dealId") UUID dealId);

    /** Batch load: live parties for many deals (N+1 safety for the deals list). */
    @Query("select dp from DealParty dp where dp.dealId in :dealIds and dp.deletedAt is null " +
            "order by dp.createdAt")
    List<DealParty> findLiveByDealIdIn(@Param("dealIds") Collection<UUID> dealIds);
}
