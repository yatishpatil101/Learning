package com.punenest.api.engagement.society;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;
import lombok.Getter;

/**
 * One item on a society's noticeboard (V102 {@code society_board_items}).
 *
 * <p><strong>Why posting is gated and reading is not.</strong> A notice is an assertion about the
 * building — the water goes off on Tuesday, the AGM is on the 14th — and a stranger is not in a
 * position to make it. Reading is open because a prospective buyer looking at an active
 * noticeboard is looking at the single most honest signal a society hub can offer: a page that
 * says nothing is a society nobody runs.
 *
 * <p><strong>Why a date is a database constraint and not just validation.</strong> An event with no
 * date sorts into the calendar and renders with an empty date cell, which is a broken page rather
 * than a rejected write. {@code ck_society_board_event_has_date} makes it unrepresentable, so a
 * future caller that bypasses the service cannot corrupt the calendar.
 *
 * <p>{@code eventTime} is deliberately optional even for an event: "sometime on the 14th" is how
 * most society notices are actually written, and forcing a time would make committees invent one.
 */
@Entity
@Table(name = "society_board_items")
@Getter
public class SocietyBoardItem extends AuditedEntity {

    @Column(name = "society_id", nullable = false, updatable = false)
    private UUID societyId;

    /** When a moderator took this off the public site, or null. The row survives a removal. */
    @Column(name = "removed_at")
    private java.time.Instant removedAt;

    /** The moderator who removed it. Paired with {@code removedAt} by a CHECK constraint. */
    @Column(name = "removed_by")
    private UUID removedBy;

    @Column(name = "author_id", nullable = false, updatable = false)
    private UUID authorId;

    @Column(name = "kind", nullable = false, updatable = false)
    private String kind;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "body")
    private String body;

    @Column(name = "category")
    private String category;

    @Column(name = "event_date")
    private LocalDate eventDate;

    @Column(name = "event_time")
    private LocalTime eventTime;

    protected SocietyBoardItem() {
    }

    SocietyBoardItem(UUID societyId, UUID authorId, String kind, String title, String body,
            String category, LocalDate eventDate, LocalTime eventTime) {
        this.societyId = societyId;
        this.authorId = authorId;
        this.kind = kind;
        this.title = title;
        this.body = body;
        this.category = category;
        this.eventDate = eventDate;
        this.eventTime = eventTime;
    }

    public boolean isEvent() {
        return SocietyBoardKinds.EVENT.equals(kind);
    }
}
