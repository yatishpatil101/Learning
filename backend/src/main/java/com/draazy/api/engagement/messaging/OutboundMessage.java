package com.draazy.api.engagement.messaging;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * One chaser, as it was composed and to whom.
 *
 * <p>This is a ledger, not a queue. Nothing reads it to decide what to send next; it exists so that
 * the second staff member to open a listing can see the first one already chased its owner
 * yesterday, and so the count on a pipeline card comes from messages rather than from a number
 * somebody incremented.
 *
 * <p><strong>{@code status} starts at {@code prepared} and, today, stays there.</strong> See
 * {@link com.draazy.api.common.trust.MessageSender} for why: click-to-chat is a real send that
 * this server cannot witness. Writing {@code sent} would be the platform asserting delivery in the
 * very table meant to be the evidence for it.
 *
 * <p>Not a {@code BaseEntity}: the base class contributes {@code created_at}, and this row already
 * has a better-named timestamp for the same instant. Two columns meaning "when" is how they end up
 * disagreeing.
 */
@Entity
@Table(name = "outbound_message")
@Getter
public class OutboundMessage {

    public static final String PREPARED = "prepared";

    @jakarta.persistence.Id
    @jakarta.persistence.GeneratedValue
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "channel", nullable = false)
    private String channel;

    @Column(name = "template_id")
    private String templateId;

    @Column(name = "subject_type", nullable = false)
    private String subjectType;

    @Column(name = "subject_id", nullable = false)
    private UUID subjectId;

    @Column(name = "recipient_id", nullable = false)
    private UUID recipientId;

    /**
     * The number this went to, captured at send time rather than read back through the user.
     *
     * <p>An owner who changes their mobile next month must not retroactively make this log claim the
     * chaser went to the new one. The user reference answers "who"; this answers "where".
     */
    @Column(name = "recipient_mobile", nullable = false)
    private String recipientMobile;

    /**
     * The fully rendered text, stored rather than reconstructed.
     *
     * <p>Templates are editable, so re-rendering at read time would show a colleague the message as
     * it reads today instead of the one the owner actually got — the opposite of what a record is
     * for. It also lets a row outlive the retirement of its template.
     */
    @Column(name = "body", nullable = false)
    private String body;

    @Column(name = "status", nullable = false)
    private String status = PREPARED;

    @Column(name = "prepared_by", nullable = false)
    private UUID preparedBy;

    @Column(name = "prepared_at", nullable = false, insertable = false, updatable = false)
    private Instant preparedAt;

    @Column(name = "sent_at")
    private Instant sentAt;

    @Column(name = "failure_reason")
    private String failureReason;

    protected OutboundMessage() {}

    OutboundMessage(
            String channel,
            String templateId,
            String subjectType,
            UUID subjectId,
            UUID recipientId,
            String recipientMobile,
            String body,
            UUID preparedBy) {
        this.channel = channel;
        this.templateId = templateId;
        this.subjectType = subjectType;
        this.subjectId = subjectId;
        this.recipientId = recipientId;
        this.recipientMobile = recipientMobile;
        this.body = body;
        this.preparedBy = preparedBy;
    }
}
