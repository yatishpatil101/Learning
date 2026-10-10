package com.draazy.api.leads.conversation;

import java.util.Collection;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ConversationMessageRepository extends JpaRepository<ConversationMessage, UUID> {

    List<ConversationMessage> findByConversationIdOrderByCreatedAtAsc(UUID conversationId);

    @Query(value = """
            select m.* from messages m
             where m.conversation_id = :conversationId
               and not exists (
                     select 1 from hidden_conversation_messages h
                      where h.message_id = m.id and h.user_id = :readerId)
             order by m.created_at asc
            """, nativeQuery = true)
    List<ConversationMessage> findVisibleByConversationIdOrderByCreatedAtAsc(
            @Param("conversationId") UUID conversationId, @Param("readerId") UUID readerId);

    @Query(value = """
            select distinct on (conversation_id) conversation_id, author_id from messages
             where conversation_id in (:conversationIds)
             order by conversation_id, created_at desc
            """, nativeQuery = true)
    List<Object[]> latestAuthors(@Param("conversationIds") Collection<UUID> conversationIds);

    Optional<ConversationMessage> findByConversationIdAndAuthorIdAndClientId(
            UUID conversationId, UUID authorId, String clientId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            insert into messages (conversation_id, author_id, author_role, body, client_id, reply_to_id)
            values (:conversationId, :authorId, :authorRole, :body, :clientId, :replyToId)
            on conflict (conversation_id, author_id, client_id) where client_id is not null
            do nothing
            """, nativeQuery = true)
    int insertWithClientId(@Param("conversationId") UUID conversationId,
            @Param("authorId") UUID authorId, @Param("authorRole") String authorRole,
            @Param("body") String body, @Param("clientId") String clientId,
            @Param("replyToId") UUID replyToId);

    Optional<ConversationMessage> findByIdAndConversationId(UUID id, UUID conversationId);

    boolean existsByConversationIdAndAuthorId(UUID conversationId, UUID authorId);

    long countByConversationIdAndAuthorIdAndCreatedAtAfter(
            UUID conversationId, UUID authorId, Instant createdAt);

    @Query("""
            select m.conversationId, count(m) from ConversationMessage m
            where m.conversationId in :conversationIds
              and m.authorId <> :readerId
              and m.read = false
            group by m.conversationId
            """)
    List<Object[]> unreadCounts(@Param("conversationIds") Collection<UUID> conversationIds,
            @Param("readerId") UUID readerId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update ConversationMessage m set m.read = true
            where m.conversationId = :conversationId
              and m.authorId <> :readerId
              and m.read = false
            """)
    int markRead(@Param("conversationId") UUID conversationId, @Param("readerId") UUID readerId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            update messages m set delivered_at = now()
              from conversations c
             where c.id = m.conversation_id
               and m.conversation_id = :conversationId
               and (c.user_a_id = :readerId or c.user_b_id = :readerId)
               and m.author_id <> :readerId
               and m.delivered_at is null
             """, nativeQuery = true)
    int markDelivered(@Param("conversationId") UUID conversationId, @Param("readerId") UUID readerId);

    @Query(value = """
            with delivered as (
              update messages m set delivered_at = now()
                from conversations c
               where c.id = m.conversation_id
                 and (c.user_a_id = :readerId or c.user_b_id = :readerId)
                 and m.author_id <> :readerId
                 and m.delivered_at is null
              returning m.conversation_id)
            select distinct conversation_id from delivered
             """, nativeQuery = true)
    List<UUID> markInboxDelivered(@Param("readerId") UUID readerId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            insert into hidden_conversation_messages (conversation_id, message_id, user_id)
            values (:conversationId, :messageId, :userId)
            on conflict do nothing
            """, nativeQuery = true)
    int hideForUser(@Param("conversationId") UUID conversationId,
            @Param("messageId") UUID messageId, @Param("userId") UUID userId);

    @Query(value = """
            select m.conversation_id, count(*) from messages m
            join conversations c on c.id = m.conversation_id
            join flatmate_group_members gm
                   on gm.group_id = c.flatmate_group_id and gm.user_id = :readerId
            left join conversation_reads r
                   on r.conversation_id = m.conversation_id and r.user_id = :readerId
            where m.conversation_id in (:conversationIds)
              and m.author_id <> :readerId
              and m.created_at > gm.created_at
              and (r.read_at is null or m.created_at > r.read_at)
            group by m.conversation_id
            """, nativeQuery = true)
    List<Object[]> groupUnreadCounts(@Param("conversationIds") Collection<UUID> conversationIds,
            @Param("readerId") UUID readerId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            insert into conversation_reads (conversation_id, user_id, read_at)
            values (:conversationId, :readerId,
                    coalesce((select max(created_at) from messages where conversation_id = :conversationId),
                             now()))
            on conflict (conversation_id, user_id) do update set read_at = excluded.read_at
            """, nativeQuery = true)
    int markGroupRead(@Param("conversationId") UUID conversationId, @Param("readerId") UUID readerId);
}
