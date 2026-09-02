package com.draazy.api.moderation.note;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Note reads.
 *
 * <p>Two shapes and no more. {@link #findByEntityTypeAndEntityIdOrderByCreatedAtDesc} is the one a
 * screen asks for — one entity's notes, newest first, index-backed by
 * {@code idx_internal_notes_entity}. {@link #countByEntityTypeAndEntityIdIn} is the badge read: a
 * console that renders "3 notes" on twenty rows must not issue twenty queries to do it.
 *
 * <p>There is no "all notes" finder and no cross-entity search. Nothing in the product asks the
 * question, and a table of unproven staff observations about named people is not one to grow an
 * open-ended read on before something needs it.
 */
public interface InternalNoteRepository extends JpaRepository<InternalNote, UUID> {

    /** One entity's notes, newest first. */
    List<InternalNote> findByEntityTypeAndEntityIdOrderByCreatedAtDesc(String entityType,
            String entityId);

    /**
     * Note counts for a page of entities of one kind, in one query.
     *
     * <p>Returns {@code [entityId, count]} rows and omits entities with no notes — a caller folding
     * this into a map should default to zero rather than expect a row per id.
     */
    @Query("""
            select n.entityId, count(n)
              from InternalNote n
             where n.entityType = :entityType
               and n.entityId in :entityIds
             group by n.entityId
            """)
    List<Object[]> countByEntityTypeAndEntityIdIn(@Param("entityType") String entityType,
            @Param("entityIds") Collection<String> entityIds);
}
