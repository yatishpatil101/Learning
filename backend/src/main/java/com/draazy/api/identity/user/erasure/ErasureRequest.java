package com.draazy.api.identity.user.erasure;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

/**
 * One right-to-erasure request. Maps the {@code erasure_requests} table (V56).
 *
 * <p><strong>The interesting property of this row is that it stops naming its subject.</strong>
 * {@link #subjectId} is a live foreign key while the request is pending — it has to be, or nothing
 * could be executed — and is set to {@code null} by {@link #complete}. What survives is
 * {@link #subjectDigest}, a one-way function of the subject's UUID under a deployment-held pepper.
 * Given a UUID you can confirm that a request concerned it; given the table you cannot enumerate who
 * was erased. See V56's header for why that asymmetry is the requirement rather than a nicety, and
 * why the digest is not taken over the mobile number.
 *
 * <p>The pairing is enforced by the database, not by remembering to call the right method:
 * {@code erasure_requests_completed_is_anonymous} refuses a completed row that still carries a
 * subject id, and {@code erasure_requests_decided_is_attributed} refuses a decided row with no
 * deciding admin.
 *
 * <p>{@link #erased} and {@link #retained} are stored as {@code jsonb} strings rather than mapped
 * collections, matching {@code AuditLog.metadata} — they are written once at execution, read as a
 * document, and never queried by key. They hold counts and category names only. Never a value.
 */
@Entity
@Table(name = "erasure_requests")
@Getter
public class ErasureRequest extends BaseEntity {

    /** The subject, while the request is live. Cleared on completion; see the class Javadoc. */
    @Column(name = "subject_id")
    private UUID subjectId;

    @Column(name = "subject_digest", nullable = false, updatable = false)
    private String subjectDigest;

    @Column(name = "status", nullable = false)
    private String status = ErasureStatuses.PENDING;

    /** The subject's own words, optional. Never used to decide anything; kept so a human can read it. */
    @Column(name = "reason", updatable = false)
    private String reason;

    @Column(name = "requested_at", nullable = false, updatable = false)
    private Instant requestedAt = Instant.now();

    /**
     * The deciding admin, in the clear.
     *
     * <p>Deliberately not pseudonymised alongside the subject. This half of the row is ops
     * accountability — an anonymous erasure decision is a power nobody can be held to — and a staff
     * member acting in role is not the Data Principal this table exists to protect.
     */
    @Column(name = "decided_by")
    private UUID decidedBy;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decision_note")
    private String decisionNote;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "erased", nullable = false)
    private String erased = "{}";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "retained", nullable = false)
    private String retained = "{}";

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected ErasureRequest() {
        // JPA
    }

    public ErasureRequest(UUID subjectId, String subjectDigest, String reason) {
        this.subjectId = subjectId;
        this.subjectDigest = subjectDigest;
        this.reason = reason;
    }

    /**
     * Mark this request carried out, and stop naming the person it was about.
     *
     * <p>Clearing {@link #subjectId} in the same method that sets the status is the only reason this
     * is a method rather than three setters: the two facts must become true together, and a caller
     * that set the status and forgot the id would leave behind exactly the directory of erased
     * people this design exists to prevent. The database check is the backstop for the day somebody
     * writes a fourth caller.
     *
     * @param erasedJson   what was removed — table names and row counts
     * @param retainedJson what was kept, and the statute that required keeping it
     */
    public void complete(UUID admin, String note, String erasedJson, String retainedJson) {
        this.status = ErasureStatuses.COMPLETED;
        this.subjectId = null;
        this.decidedBy = admin;
        this.decidedAt = Instant.now();
        this.decisionNote = note;
        this.erased = erasedJson;
        this.retained = retainedJson;
    }

    /**
     * Refuse the request, with a reason.
     *
     * <p>{@link #subjectId} is deliberately <em>kept</em>. Nothing was erased, so the account still
     * exists and still needs to be reachable — most obviously by the subject, who is entitled to see
     * why they were refused and to ask again when the obligation that blocked them ends.
     */
    public void reject(UUID admin, String note) {
        this.status = ErasureStatuses.REJECTED;
        this.decidedBy = admin;
        this.decidedAt = Instant.now();
        this.decisionNote = note;
    }
}
