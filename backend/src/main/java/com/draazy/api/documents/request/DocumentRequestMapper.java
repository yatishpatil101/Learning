package com.draazy.api.documents.request;

import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.identity.user.User;
import java.time.Instant;
import org.springframework.stereotype.Component;

/** Requester mobile is masked unconditionally: granting documents must not also hand over a number and
 * bypass the contact gate. Hand-written so no configuration can turn that off. */
@Component
public class DocumentRequestMapper {

    public DocumentRequestDto toDto(DocumentRequest row, User requester, int sharedDocumentCount) {
        String status = projectedStatus(row);
        return new DocumentRequestDto(
                row.getId().toString(),
                row.getPropertyId().toString(),
                toParty(requester),
                row.getCategories(),
                status,
                sharedDocumentCount,
                row.getExpiresAt(),
                row.isAcknowledgedDisclaimer(),
                row.getCreatedAt());
    }

    /** The requester's own projection of the row: a document count only once the ask is granted. */
    public DocumentRequestDto toRequesterDto(
            DocumentRequest row, User requester, int sharedDocumentCount) {
        String status = projectedStatus(row);
        return new DocumentRequestDto(
                row.getId().toString(),
                row.getPropertyId().toString(),
                toParty(requester),
                row.getCategories(),
                status,
                DocumentRequestStatuses.GRANTED.equals(status) ? sharedDocumentCount : 0,
                row.getExpiresAt(),
                row.isAcknowledgedDisclaimer(),
                row.getCreatedAt());
    }

    /** Expiry is derived from the clock so a lapsed row never renders "granted" while reads refuse it. */
    private String projectedStatus(DocumentRequest row) {
        if (DocumentRequestStatuses.GRANTED.equals(row.getStatus())
                && row.getExpiresAt() != null && !row.getExpiresAt().isAfter(Instant.now())) {
            return DocumentRequestStatuses.EXPIRED;
        }
        return row.getStatus();
    }

    private DocumentRequestDto.Party toParty(User requester) {
        if (requester == null) {
            return null;
        }
        return new DocumentRequestDto.Party(requester.getId().toString(), requester.getName(),
                MobileMask.mask(requester.getMobile()), "buyer");
    }
}
