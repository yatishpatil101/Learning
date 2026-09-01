package com.punenest.api.documents.request;

import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;
import java.time.Instant;
import org.springframework.stereotype.Component;

/**
 * Entity→wire projection for document requests.
 *
 * <p><strong>The requester's mobile is masked unconditionally.</strong> Unlike the contact gate,
 * this surface has no reveal at all: granting document access is a decision about <em>documents</em>,
 * and letting it also hand over a phone number would quietly route around the contact gate that
 * exists to make that a separate, explicit choice. Hand-written rather than MapStruct so that
 * property is five readable lines with no configuration that could turn it off.
 */
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
                row.getShareToken(),
                row.getExpiresAt(),
                row.isAcknowledgedDisclaimer(),
                row.getCreatedAt());
    }

    /**
     * The same row as {@link #toDto}, projected for the <em>requester</em>: identical but for the
     * share token, which is always {@code null} here (D123).
     *
     * <p>{@code shareToken} is owner-facing by contract — the owner is shown it so they can forward
     * the link deliberately. The buyer's own list is a status view: it says whether the ask was
     * granted, not what the grant unlocks. Echoing the token onto a paged list would make one
     * leaked response, or one shoulder-surfed screen, worth every vault the caller has ever been
    * granted, for the full seven days of each grant. The buyer needs no token: their signed-in
    * read is {@code /me/document-requests/{reqId}/documents}, requester-scoped by JWT.
     *
     * <p>A separate method rather than a boolean on {@link #toDto} so that the redaction cannot be
     * switched off by a caller passing the wrong flag: the only way to get a token out of this
     * mapper is to ask for the owner's projection by name.
     */
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
                null,
                row.getExpiresAt(),
                row.isAcknowledgedDisclaimer(),
                row.getCreatedAt());
    }

    /**
     * Expiry is a clock fact, not a background-job label. Deriving it here keeps a lapsed row from
     * rendering "granted" while both document-read endpoints correctly refuse it.
     */
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
