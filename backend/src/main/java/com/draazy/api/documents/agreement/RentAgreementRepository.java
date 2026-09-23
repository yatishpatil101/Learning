package com.draazy.api.documents.agreement;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RentAgreementRepository extends JpaRepository<RentAgreement, UUID> {

    /** The two sides match on different columns: owner is a user id, tenant only ever a mobile. Pass a
     * {@code MobileMask.normalise}d value; the {@code is not null} guard stops blanks matching blanks. */
    @Query("""
            select a from RentAgreement a
            where a.ownerId = :ownerId
               or (:mobile is not null and a.tenantMobile = :mobile)
            order by a.createdAt desc
            """)
    List<RentAgreement> findForParty(@Param("ownerId") UUID ownerId, @Param("mobile") String mobile);

    /** Sole evidence behind a badge granted with no human in the loop: an archive column added to
     * {@code RentAgreement} must be excluded here in the same change. Matches the licensee, not the landlord. */
    @Query("""
            select count(a) > 0 from RentAgreement a
            where a.propertyId = :propertyId
              and :mobile is not null and a.tenantMobile = :mobile
              and a.status in ('registered', 'active')
            """)
    boolean hasRegisteredTenancy(@Param("propertyId") UUID propertyId, @Param("mobile") String mobile);
}
