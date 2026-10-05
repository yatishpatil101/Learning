package com.draazy.api.services.request;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ServiceRequestRegistrationRepository
        extends JpaRepository<ServiceRequestRegistration, UUID> {

    List<ServiceRequestRegistration> findByServiceRequestIdIn(List<UUID> serviceRequestIds);

    @Query("select count(r) > 0 from ServiceRequestRegistration r where upper(r.grn) = upper(:grn)")
    boolean grnRecorded(@Param("grn") String grn);

    @Query("""
            select count(r) > 0 from ServiceRequestRegistration r
             where lower(r.sro) = lower(:sro) and upper(r.documentNo) = upper(:documentNo)
               and extract(year from r.registeredOn) = :year
            """)
    boolean documentRecorded(@Param("sro") String sro, @Param("documentNo") String documentNo,
            @Param("year") int year);
}
