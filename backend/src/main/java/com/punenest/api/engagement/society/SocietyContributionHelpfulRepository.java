package com.punenest.api.engagement.society;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Helpful votes, read as aggregates and written as single rows. */
public interface SocietyContributionHelpfulRepository
        extends JpaRepository<SocietyContributionHelpful, SocietyContributionHelpful.Id> {

    /**
     * How many people found each of these contributions helpful.
     *
     * <p>Returns {@code [contributionId, count]} pairs rather than a map because JPQL cannot
     * project one; the caller collects it. Contributions nobody has voted on are simply absent,
     * which the caller reads as zero — the alternative is a left join whose only purpose is to
     * produce rows saying "none".
     */
    @Query("""
            select h.id.contributionId, count(h)
            from SocietyContributionHelpful h
            where h.id.contributionId in :contributionIds
            group by h.id.contributionId
            """)
    List<Object[]> countsFor(@Param("contributionIds") List<UUID> contributionIds);

    /**
     * Which of these contributions this particular person has already found helpful.
     *
     * <p>One query for a whole page, so the button can render pressed or unpressed on first paint
     * instead of guessing and correcting.
     */
    @Query("""
            select h.id.contributionId
            from SocietyContributionHelpful h
            where h.id.userId = :userId and h.id.contributionId in :contributionIds
            """)
    Set<UUID> votedBy(@Param("userId") UUID userId, @Param("contributionIds") List<UUID> contributionIds);

    long countByIdContributionId(UUID contributionId);
}
