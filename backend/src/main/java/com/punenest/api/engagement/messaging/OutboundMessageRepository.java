package com.punenest.api.engagement.messaging;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/** Reads over the outreach ledger. */
@Repository
public interface OutboundMessageRepository extends JpaRepository<OutboundMessage, UUID> {

    /** The chaser history for one thing, newest first — the Follow-up tab's timeline. */
    List<OutboundMessage> findBySubjectTypeAndSubjectIdOrderByPreparedAtDesc(String subjectType, UUID subjectId);

    /**
     * How many chasers each of these listings has had.
     *
     * <p>Batched over a collection of ids rather than offered per-listing, because the caller is a
     * mapper running across a page of moderation rows. A {@code countBySubjectId} would be correct
     * and would issue one query per card — the same shape of mistake D214 removed from the KPI
     * counts, arriving from the other direction.
     *
     * <p>Returns {@code [subjectId, count]} pairs and omits listings with no outreach at all, so the
     * caller must default a missing id to zero rather than expecting a row of zero.
     */
    @Query("""
            select m.subjectId, count(m)
            from OutboundMessage m
            where m.subjectType = :subjectType and m.subjectId in :subjectIds
            group by m.subjectId
            """)
    List<Object[]> countBySubjects(
            @Param("subjectType") String subjectType, @Param("subjectIds") java.util.Collection<UUID> subjectIds);
}
