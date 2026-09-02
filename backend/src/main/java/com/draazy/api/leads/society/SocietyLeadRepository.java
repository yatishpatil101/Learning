package com.draazy.api.leads.society;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads over {@code society_leads} (V24). */
public interface SocietyLeadRepository extends JpaRepository<SocietyLead, UUID> {

    /**
     * The pipeline, newest first, optionally one column at a time.
     *
     * <p>Null-tolerant rather than two methods: an absent {@code status} means "the whole pipeline",
     * and writing that as a second finder duplicates the ordering, which is the part that is easy to
     * get subtly different. Served by {@code idx_society_leads_status_created}.
     */
    @Query("""
            select l from SocietyLead l
            where (:status is null or l.status = :status)
            order by l.createdAt desc, l.id desc
            """)
    Page<SocietyLead> pipeline(@Param("status") String status, Pageable pageable);

    /**
     * How many leads this number has filed since {@code since} — the public submit path's rate
     * limit. Served by {@code idx_society_leads_mobile_created}.
     */
    long countByMobileAndCreatedAtAfter(String mobile, Instant since);
}
