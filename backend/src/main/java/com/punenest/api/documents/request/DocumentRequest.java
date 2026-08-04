package com.punenest.api.documents.request;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A buyer's ask for access to a listing's documents, and the owner's answer. Maps
 * {@code document_requests} (V6, extended by V20).
 *
 * <p>{@code categories} is jsonb rather than a child table because it is a closed list the request
 * carries with it, never queried across requests — the shape the contract shows is the shape
 * stored.
 *
 * <p>{@code shareToken} and {@code expiresAt} are set together, only on a grant, and only by
 * {@link DocumentRequestService}. Neither ever comes from a request body: a client that could
 * choose its own token could choose someone else's.
 */
@Entity
@Table(name = "document_requests")
@Getter
public class DocumentRequest extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /** The asking user. Always taken from the JWT — never from the request body. */
    @Column(name = "requester_id", nullable = false, updatable = false)
    private UUID requesterId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "categories", nullable = false)
    private List<String> categories = new ArrayList<>();

    /** One of {@link DocumentRequestStatuses}; the V6 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    private String status = DocumentRequestStatuses.PENDING;

    @Column(name = "share_token")
    private String shareToken;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "acknowledged_disclaimer", nullable = false)
    @Setter
    private boolean acknowledgedDisclaimer;

    /** The buyer's covering note to the owner. */
    @Column(name = "message")
    @Setter
    private String message;

    protected DocumentRequest() {
        // JPA
    }

    public DocumentRequest(UUID propertyId, UUID requesterId, List<String> categories,
            String message, boolean acknowledgedDisclaimer) {
        this.propertyId = propertyId;
        this.requesterId = requesterId;
        this.categories = categories == null ? new ArrayList<>() : new ArrayList<>(categories);
        this.message = message;
        this.acknowledgedDisclaimer = acknowledgedDisclaimer;
    }

    /** Grant this request: mint the link and start its clock, in one place. */
    public void grant(String shareToken, Instant expiresAt) {
        this.status = DocumentRequestStatuses.GRANTED;
        this.shareToken = shareToken;
        this.expiresAt = expiresAt;
    }

    /**
     * Decline: no token is minted, and any that somehow existed is dropped. A declined request must
     * never leave a live link behind.
     */
    public void decline() {
        this.status = DocumentRequestStatuses.DECLINED;
        this.shareToken = null;
        this.expiresAt = null;
    }

    public void setCategories(List<String> categories) {
        this.categories = categories == null ? new ArrayList<>() : new ArrayList<>(categories);
    }

}
