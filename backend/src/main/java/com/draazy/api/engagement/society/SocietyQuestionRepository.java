package com.draazy.api.engagement.society;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Questions on a society hub. */
public interface SocietyQuestionRepository extends JpaRepository<SocietyQuestion, UUID> {

    /**
     * Newest question first — a hub is read for what is being asked now, not what was asked first.
     *
     * <p>Tie-broken on the id, because the clock this runs on ticks about once a millisecond and two
     * questions asked inside one tick carry the same {@code created_at}. An order that is undefined
     * for equal timestamps is not merely arbitrary on a paged read: the same row can come back on
     * page 1 and page 2 while another is never returned at all.
     */
    Page<SocietyQuestion> findBySocietyIdAndRemovedAtIsNullOrderByCreatedAtDescIdDesc(
            UUID societyId, Pageable pageable);

    /**
     * Every answer to a page of questions, in one query.
     *
     * <p>Answers are fetched by the question ids the page actually returned rather than mapped as a
     * JPA collection, because a {@code @OneToMany} here would either lazily fire one query per
     * question or force a join that breaks paging — a page of 20 questions would come back as
     * however many rows the answers make.
     */
    @Query("""
            select a from SocietyAnswer a
            where a.questionId in :questionIds
              and a.removedAt is null
            order by a.createdAt
            """)
    List<SocietyAnswer> answersFor(@Param("questionIds") List<UUID> questionIds);

    /**
     * Take one question off the public site, on a moderator's authority. Its answers go with it,
     * because they are only readable through it — a thread whose question has gone is a page of
     * replies to nothing.
     *
     * @return 1 if this call removed it, 0 if it was already gone
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update society_questions
               set removed_at = now(), removed_by = :moderatorId, updated_at = now()
             where id = :id and removed_at is null
            """, nativeQuery = true)
    int markRemoved(@Param("id") UUID id, @Param("moderatorId") UUID moderatorId);

    /** Take one answer off the public site, leaving the question it hangs on alone. */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update society_answers
               set removed_at = now(), removed_by = :moderatorId, updated_at = now()
             where id = :id and removed_at is null
            """, nativeQuery = true)
    int markAnswerRemoved(@Param("id") UUID id, @Param("moderatorId") UUID moderatorId);
}
