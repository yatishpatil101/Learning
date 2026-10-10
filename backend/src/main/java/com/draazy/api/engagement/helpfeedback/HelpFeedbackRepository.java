package com.draazy.api.engagement.helpfeedback;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** Extends {@link Repository} rather than {@code JpaRepository} on purpose: inheriting the usual base
 * would hand the codebase {@code findAll} and {@code deleteAll} on a table with one writer. */
public interface HelpFeedbackRepository extends Repository<HelpFeedback, UUID> {

    @Modifying
    @Query(value = """
            insert into help_article_feedback (slug, lang, helpful, comment, user_id, ip_hash, voter_key)
            values (:slug, :lang, :helpful, :comment, :userId, :ipHash, :voterKey)
            on conflict (slug, lang, voter_key) do update
               set helpful = excluded.helpful,
                   comment = excluded.comment,
                   ip_hash = excluded.ip_hash,
                   created_at = now()
            """, nativeQuery = true)
    void upsert(String slug, String lang, boolean helpful, String comment, UUID userId, String ipHash,
            String voterKey);

    long countBySlugAndIpHashAndCreatedAtAfter(String slug, String ipHash,
            Instant createdAt);
}