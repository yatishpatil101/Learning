package com.punenest.api.finance.rent;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads and writes {@link RentMandate}. */
public interface RentMandateRepository extends JpaRepository<RentMandate, UUID> {

    /**
     * The tenancy's mandate that still exists in any usable sense — {@code active} or {@code paused}.
     *
     * <p><strong>Not "active only", and the difference is load-bearing.</strong> An active-only
     * lookup cannot see a paused mandate, so a tenant who paused autopay could never afterwards
     * resume or revoke it: the write path would report "no mandate to update" while the standing
     * instruction sat there uncancellable. A revoked one is genuinely gone and is excluded, which is
     * what lets a tenant set autopay up again afterwards.
     */
    @Query("select m from RentMandate m where m.tenancyId = :tenancyId and m.status <> 'revoked'")
    Optional<RentMandate> findLiveByTenancyId(@Param("tenancyId") UUID tenancyId);

    /**
     * The caller's live mandate across all their tenancies, newest first.
     *
     * <p>{@code GET /me/rent-mandate} is singular and takes no tenancy id, so "the" mandate has to
     * be derived. A tenant with two rentals could in principle have two, and the contract has no
     * way to express that — see {@code RentService.getMandate} for the ruling.
     *
     * <p>Paused mandates are included: one the tenant cannot see is one they cannot resume or
     * cancel, and the UI needs it on screen to offer either button.
     */
    @Query("select m from RentMandate m, Tenancy t "
            + "where m.tenancyId = t.id and t.tenantId = :tenantId and m.status <> 'revoked' "
            + "order by m.createdAt desc")
    java.util.List<RentMandate> findLiveByTenantId(@Param("tenantId") UUID tenantId);
}
