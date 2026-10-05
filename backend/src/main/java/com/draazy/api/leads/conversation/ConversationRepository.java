package com.draazy.api.leads.conversation;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

// Canonical party ordering keeps lookups as index seeks instead of OR scans.
// Every finder relies on the the migration canonical pair ordering (`user_a_id < user_b_id`).
public interface ConversationRepository extends JpaRepository<Conversation, UUID> {

    @Query("""
            select c from Conversation c
            where c.userAId = :userId or c.userBId = :userId
            order by c.updatedAt desc
            """)
    Page<Conversation> inboxOf(@Param("userId") UUID userId, Pageable pageable);

    @Query("""
            select c from Conversation c
            where c.userAId = :userId or c.userBId = :userId or c.flatmateGroupId in :groupIds
            order by c.updatedAt desc
            """)
    Page<Conversation> inboxWithGroups(@Param("userId") UUID userId,
            @Param("groupIds") Collection<UUID> groupIds, Pageable pageable);

    @Query("""
            select c from Conversation c
            where c.flatmateGroupId is null and (c.userAId = :userId or c.userBId = :userId)
            """)
    List<Conversation> directFor(@Param("userId") UUID userId);

    Optional<Conversation> findByFlatmateGroupId(UUID flatmateGroupId);

    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into conversations (id, flatmate_group_id)
            values (gen_random_uuid(), :groupId)
            on conflict (flatmate_group_id) do nothing
            """, nativeQuery = true)
    int insertGroupIfAbsent(@Param("groupId") UUID groupId);

    @Query("""
            select c from Conversation c
            where c.userAId = :lower and c.userBId = :higher
              and ((:propertyId is null and c.propertyId is null) or c.propertyId = :propertyId)
            """)
    Optional<Conversation> findPair(@Param("lower") UUID lower, @Param("higher") UUID higher,
            @Param("propertyId") UUID propertyId);

    @Query(value = """
            select conversation_id, archived, muted from conversation_user_state
             where user_id = :userId and conversation_id in (:conversationIds)
            """, nativeQuery = true)
    List<Object[]> states(@Param("userId") UUID userId,
            @Param("conversationIds") Collection<UUID> conversationIds);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            insert into conversation_user_state (conversation_id, user_id, archived, muted)
            values (:conversationId, :userId, coalesce(:archived, false), coalesce(:muted, false))
            on conflict (conversation_id, user_id) do update
               set archived = coalesce(:archived, conversation_user_state.archived),
                   muted = coalesce(:muted, conversation_user_state.muted),
                   updated_at = now()
            """, nativeQuery = true)
    int upsertState(@Param("conversationId") UUID conversationId, @Param("userId") UUID userId,
            @Param("archived") Boolean archived, @Param("muted") Boolean muted);

    @Query(value = """
            select coalesce((
                select muted from conversation_user_state
                 where conversation_id = :conversationId and user_id = :userId), false)
            """, nativeQuery = true)
    boolean muted(@Param("conversationId") UUID conversationId, @Param("userId") UUID userId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update conversation_user_state set archived = false, updated_at = now()
             where conversation_id = :conversationId and user_id <> :authorId and archived = true
            """, nativeQuery = true)
    int unarchiveOthers(@Param("conversationId") UUID conversationId, @Param("authorId") UUID authorId);

    @Query(value = """
            select blocker_id, blocked_id from user_blocks
             where (blocker_id = :readerId and blocked_id in (:counterpartyIds))
                or (blocked_id = :readerId and blocker_id in (:counterpartyIds))
            """, nativeQuery = true)
    List<Object[]> blocksFor(@Param("readerId") UUID readerId,
            @Param("counterpartyIds") Collection<UUID> counterpartyIds);

    @Query(value = """
            select exists (
                select 1 from user_blocks
                 where (blocker_id = :one and blocked_id = :other)
                    or (blocker_id = :other and blocked_id = :one))
            """, nativeQuery = true)
    boolean blockedEitherWay(@Param("one") UUID one, @Param("other") UUID other);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            insert into user_blocks (blocker_id, blocked_id)
            values (:blockerId, :blockedId)
            on conflict do nothing
            """, nativeQuery = true)
    int block(@Param("blockerId") UUID blockerId, @Param("blockedId") UUID blockedId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "delete from user_blocks where blocker_id = :blockerId and blocked_id = :blockedId",
            nativeQuery = true)
    int unblock(@Param("blockerId") UUID blockerId, @Param("blockedId") UUID blockedId);

    @Query(value = """
            select count(*) from messages m
            join conversations c on c.id = m.conversation_id
            left join conversation_user_state s
                   on s.conversation_id = c.id and s.user_id = :readerId
            where (c.user_a_id = :readerId or c.user_b_id = :readerId)
              and coalesce(s.muted, false) = false
              and m.author_id <> :readerId
              and m.read = false
            """, nativeQuery = true)
    long directUnreadCount(@Param("readerId") UUID readerId);

    @Query(value = """
            select count(*) from messages m
            join conversations c on c.id = m.conversation_id
            join flatmate_group_members gm
                 on gm.group_id = c.flatmate_group_id and gm.user_id = :readerId
            left join conversation_reads r
                   on r.conversation_id = c.id and r.user_id = :readerId
            left join conversation_user_state s
                   on s.conversation_id = c.id and s.user_id = :readerId
            where c.flatmate_group_id in (:groupIds)
              and coalesce(s.muted, false) = false
              and m.author_id <> :readerId
              and m.created_at > gm.created_at
              and (r.read_at is null or m.created_at > r.read_at)
            """, nativeQuery = true)
    long groupUnreadCount(@Param("readerId") UUID readerId,
            @Param("groupIds") Collection<UUID> groupIds);
}
