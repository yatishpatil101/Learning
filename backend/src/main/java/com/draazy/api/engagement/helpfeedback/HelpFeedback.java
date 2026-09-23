package com.draazy.api.engagement.helpfeedback;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UuidGenerator;

/** The rationale for every column below is in the {@code COMMENT ON} clauses of {@code V36}. */
@Entity
@Table(name = "help_article_feedback")
@Getter
public class HelpFeedback {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Setter
    @Column(name = "slug", nullable = false, updatable = false)
    private String slug;

    @Setter
    @Column(name = "lang", nullable = false, updatable = false)
    private String lang;

    @Setter
    @Column(name = "helpful", nullable = false, updatable = false)
    private boolean helpful;

    @Setter
    @Column(name = "comment", updatable = false)
    private String comment;

    @Setter
    @Column(name = "user_id", updatable = false)
    private UUID userId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
