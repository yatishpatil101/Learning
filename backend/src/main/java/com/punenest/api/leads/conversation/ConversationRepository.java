package com.punenest.api.leads.conversation;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Reads over {@code conversations}. Every finder relies on the V22 canonical pair ordering
 * ({@code user_a_id < user_b_id}), which is what lets the lookups be index seeks rather than an
 * {@code OR} across two columns.
 */
public interface ConversationRepository extends JpaRepository<Conversation, UUID> {

    /**
     * The caller's inbox, most recent first, paged. Serves {@code idx_conversations_a_recent} and
     * {@code idx_conversations_b_recent}.
     *
     * <p>The {@code OR} is unavoidable here — the caller may be on either side of the pair, and
     * that is the price of storing a relationship in one row rather than two. Postgres satisfies it
     * with a bitmap OR over the two indexes; the alternative (a row per participant) doubles the
     * write and reintroduces the fork this table was just fixed to prevent.
     *
     * <p>The literal {@code order by} stays and callers must pass an <em>unsorted</em>
     * {@code Pageable}: Spring appends a sorted one's clause after this, producing two
     * {@code order by} clauses and invalid SQL. The ordering is not a client choice anyway — an
     * inbox is by definition most-recent-first.
     */
    @Query("""
            select c from Conversation c
            where c.userAId = :userId or c.userBId = :userId
            order by c.updatedAt desc
            """)
    Page<Conversation> inboxOf(@Param("userId") UUID userId, Pageable pageable);

    /**
     * The find-or-create probe: is there already a thread between these two about this listing?
     *
     * <p>The pair must be passed already canonicalised (see {@code Conversation.ordersFirst}) — this
     * is the same ordering the unique indexes enforce, so a caller that gets it wrong finds nothing
     * and then fails the insert, loudly, rather than quietly creating the second thread.
     * {@code propertyId} is compared with a null-safe test because a general conversation (no
     * listing) is a legitimate row and {@code = null} would never match it.
     */
    @Query("""
            select c from Conversation c
            where c.userAId = :lower and c.userBId = :higher
              and ((:propertyId is null and c.propertyId is null) or c.propertyId = :propertyId)
            """)
    Optional<Conversation> findPair(@Param("lower") UUID lower, @Param("higher") UUID higher,
            @Param("propertyId") UUID propertyId);
}
