package com.draazy.api.documents.agreement;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
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

    List<RentAgreement> findByServiceRequestIdOrderByCreatedAtAsc(UUID serviceRequestId);

    /** Filed outside a paid request, so no service request carries them and the overlap check would miss them. */
    @Query("""
            select a from RentAgreement a
            where a.propertyId = :propertyId
              and a.serviceRequestId is null
              and a.status in ('e-sign-pending', 'registered', 'active')
            order by a.createdAt asc
            """)
    List<RentAgreement> findFiledOnListing(@Param("propertyId") UUID propertyId);

    /** Two checkers deciding one row at once must not both pass the ladder and let the last write win. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from RentAgreement a where a.id = :id")
    Optional<RentAgreement> lockById(@Param("id") UUID id);

    /** Sole evidence for a badge granted with no human in the loop: a new archive column on {@code RentAgreement}
     * must be excluded here. Matches the licensee only, on paid requests a second staff member verified. */
    @Query("""
            select count(a) > 0 from RentAgreement a
            where a.propertyId = :propertyId
              and :mobile is not null and a.tenantMobile = :mobile
              and a.status in ('registered', 'active')
              and a.serviceRequestId is not null
              and a.finalDocumentId is not null
              and a.verifiedBy is not null
            """)
    boolean hasRegisteredTenancy(@Param("propertyId") UUID propertyId, @Param("mobile") String mobile);
}
