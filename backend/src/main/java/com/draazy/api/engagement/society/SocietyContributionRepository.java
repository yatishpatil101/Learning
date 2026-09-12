package com.draazy.api.engagement.society;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Community-tab posts for one society. */
public interface SocietyContributionRepository extends JpaRepository<SocietyContribution, UUID> {

    /**
     * Every contribution on a society, most-helpful first and then newest.
     *
     * <p>Deliberately <strong>unfiltered by kind</strong>, unlike the noticeboard. The community
     * tab draws filter chips carrying a count for every bucket including the ones you are not
     * looking at, so a filtered read could not serve the page anyway — and a list and a set of
     * counts fetched separately are two answers that can disagree. One read, filtered in the
     * browser, cannot.
     *
     * <p>The ordering is a correlated {@code count} rather than a stored column so that it cannot
     * drift from the votes themselves; see {@link SocietyContributionHelpful}.
     */
    @Query("""
            select c from SocietyContribution c
            where c.societyId = :societyId
              and c.removedAt is null
            order by (select count(h) from SocietyContributionHelpful h
                      where h.id.contributionId = c.id) desc, c.createdAt desc, c.id desc
            """)
    Page<SocietyContribution> contributionsFor(@Param("societyId") UUID societyId, Pageable pageable);

    /**
     * Replies for a page of contributions, oldest first, in one query.
     *
     * <p>A mapped {@code @OneToMany} would either fire one query per card or force a join that
     * makes the page size a lie. Callers must guard the empty case — {@code in ()} is not valid
     * SQL.
     */
    @Query("""
            select r from SocietyContributionReply r
            where r.contributionId in :contributionIds
              and r.removedAt is null
            order by r.createdAt
            """)
    List<SocietyContributionReply> repliesFor(@Param("contributionIds") List<UUID> contributionIds);

    /**
     * Take one contribution off the public site, on a moderator's authority.
     *
     * <p>Guarded on {@code removed_at is null} <em>in the statement</em>, so a second moderator
     * clearing the same complaint affects zero rows rather than overwriting the record of who
     * removed it first — which is the only thing that answers an appeal.
     *
     * @return 1 if this call removed it, 0 if it was already gone
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update society_contributions
               set removed_at = now(), removed_by = :moderatorId, updated_at = now()
             where id = :id and removed_at is null
            """, nativeQuery = true)
    int markRemoved(@Param("id") UUID id, @Param("moderatorId") UUID moderatorId);

    /** Take one reply off the public site. Same guard, same reason. */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update society_contribution_replies
               set removed_at = now(), removed_by = :moderatorId, updated_at = now()
             where id = :id and removed_at is null
            """, nativeQuery = true)
    int markReplyRemoved(@Param("id") UUID id, @Param("moderatorId") UUID moderatorId);
}
