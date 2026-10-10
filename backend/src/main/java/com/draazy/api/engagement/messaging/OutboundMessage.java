package com.draazy.api.engagement.messaging;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/** A ledger, not a queue: {@code sent} is a staff attestation, not a provider ack. */
@Entity
@Table(name = "outbound_message")
@Getter
public class OutboundMessage {

    public static final String PREPARED = "prepared";
    public static final String SENT = "sent";

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

    /** Captured at send time so a later mobile change doesn't rewrite the log's "where". */
    @Column(name = "recipient_mobile", nullable = false)
    private String recipientMobile;

    /** Fully rendered text stored, not reconstructed: templates are editable and rows outlive them. */
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

    public void markSent() {
        if (sentAt == null) {
            status = SENT;
            sentAt = Instant.now();
        }
    }
}
