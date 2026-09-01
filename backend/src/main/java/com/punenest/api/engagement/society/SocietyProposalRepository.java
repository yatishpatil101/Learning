package com.punenest.api.engagement.society;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Community proposals about a society: detail suggestions, the WhatsApp invite, the map pin. */
public interface SocietyProposalRepository extends JpaRepository<SocietyProposal, UUID> {

    /**
     * The pending proposal of one kind for one society, if any.
     *
     * <p>Backed by {@code uq_society_proposal_pending}, so there is at most one and this can return
     * an {@link Optional} rather than a list somebody has to decide how to reduce.
     */
    @Query("""
            select p from SocietyProposal p
            where p.societyId = :societyId and p.kind = :kind and p.status = 'pending'""")
    Optional<SocietyProposal> pending(@Param("societyId") UUID societyId,
            @Param("kind") String kind);

    /**
     * Everything currently pending for one society, all kinds at once.
     *
     * <p>The hub needs all three on first paint — "your suggestion is being reviewed", "the group
     * link is awaiting approval", "your pin correction is pending" — and three round trips to
     * learn three booleans is three chances for the page to render half a state.
     */
    @Query("""
            select p from SocietyProposal p
            where p.societyId = :societyId and p.status = 'pending'""")
    List<SocietyProposal> pendingFor(@Param("societyId") UUID societyId);

    /**
     * The most recently approved proposal of one kind, which is where the live WhatsApp invite
     * lives.
     *
     * <p>The other two kinds write their value onto the society and never need reading back. The
     * invite deliberately does not: it is handed only to verified residents, and a column on a row
     * the public detail endpoint serves is one refactor away from being published.
     */
    @Query("""
            select p from SocietyProposal p
            where p.societyId = :societyId and p.kind = :kind and p.status = 'approved'
            order by p.decidedAt desc""")
    List<SocietyProposal> approved(@Param("societyId") UUID societyId, @Param("kind") String kind);

    /**
     * The ops queue, oldest first — the proposal that has waited longest is the one somebody is
     * still waiting on.
     *
     * <p>Both filters are nullable so one query serves "everything pending", "every location fix"
     * and "this one operator's current screen" without three near-identical methods drifting apart.
     */
    @Query("""
            select p from SocietyProposal p
            where (:status is null or p.status = :status)
              and (:kind is null or p.kind = :kind)
            order by p.createdAt asc""")
    Page<SocietyProposal> queue(@Param("status") String status, @Param("kind") String kind,
            Pageable pageable);
}
