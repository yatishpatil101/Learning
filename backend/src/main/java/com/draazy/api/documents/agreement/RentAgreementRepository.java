package com.draazy.api.documents.agreement;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RentAgreementRepository extends JpaRepository<RentAgreement, UUID> {

    /**
     * Every agreement the caller is a <em>party</em> to — theirs as the landlord who filed it, and
     * theirs as the tenant it was filed against.
     *
     * <p>The two sides are matched on different columns because they are stored differently: the
     * owner is a user id (the filer is always a registered account), while the tenant is only ever
     * a mobile number, because an owner can record an agreement before the tenant has signed up.
     * That asymmetry is why this cannot be a single {@code findByPartyId}.
     *
     * <p>{@code mobile} is compared against the stored canonical ten digits, so callers must pass
     * a {@code MobileMask.normalise}d value. A null or blank mobile matches nothing rather than
     * everything — the {@code and ... is not null} guard is load-bearing, since a bare
     * {@code tenantMobile = null} in SQL is never true but a blank string would match any row
     * whose tenant column was also blank.
     */
    @Query("""
            select a from RentAgreement a
            where a.ownerId = :ownerId
               or (:mobile is not null and a.tenantMobile = :mobile)
            order by a.createdAt desc
            """)
    List<RentAgreement> findForParty(@Param("ownerId") UUID ownerId, @Param("mobile") String mobile);
}
