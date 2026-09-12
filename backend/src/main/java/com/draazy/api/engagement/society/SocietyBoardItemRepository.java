package com.draazy.api.engagement.society;

import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** The society noticeboard. */
public interface SocietyBoardItemRepository extends JpaRepository<SocietyBoardItem, UUID> {

    /**
     * One society's board, optionally narrowed to events or notices.
     *
     * <p>The ordering is the whole reason this is a {@code @Query} and not a derived name. A board
     * is read as a calendar with an announcements column beside it: an upcoming event is more
     * useful than a recent one, so events sort by their date <em>ascending</em>, while notices have
     * no date and sort newest first. One ordering for both would bury next week's AGM under a
     * notice about the lift.
     *
     * <p>The leading {@code case} puts every event ahead of every notice explicitly, rather than
     * relying on where a null {@code event_date} happens to sort. Postgres puts nulls last for an
     * ascending order and first for a descending one, and an ordering rule that depends on which
     * direction somebody last edited is not a rule.
     */
    @Query("""
            select b from SocietyBoardItem b
            where b.societyId = :societyId
              and b.removedAt is null
              and (:kind is null or b.kind = :kind)
            order by case when b.eventDate is null then 1 else 0 end asc,
                     b.eventDate asc,
                     b.createdAt desc,
                     b.id desc
            """)
    Page<SocietyBoardItem> boardFor(@Param("societyId") UUID societyId,
            @Param("kind") String kind, Pageable pageable);

    /**
     * Take one noticeboard item off the public site, on a moderator's authority.
     *
     * @return 1 if this call removed it, 0 if it was already gone
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update society_board_items
               set removed_at = now(), removed_by = :moderatorId, updated_at = now()
             where id = :id and removed_at is null
            """, nativeQuery = true)
    int markRemoved(@Param("id") UUID id, @Param("moderatorId") UUID moderatorId);
}
