package com.punenest.api.documents.request;

import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;
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

    public DocumentRequestDto toDto(DocumentRequest row, User requester) {
        return new DocumentRequestDto(
                row.getId().toString(),
                row.getPropertyId().toString(),
                toParty(requester),
                row.getCategories(),
                row.getStatus(),
                row.getShareToken(),
                row.getExpiresAt(),
                row.isAcknowledgedDisclaimer(),
                row.getCreatedAt());
    }

    private DocumentRequestDto.Party toParty(User requester) {
        if (requester == null) {
            return null;
        }
        return new DocumentRequestDto.Party(requester.getId().toString(), requester.getName(),
                MobileMask.mask(requester.getMobile()), "buyer");
    }
}
