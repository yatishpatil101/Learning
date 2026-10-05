package com.draazy.api.documents.vault;

import com.draazy.api.common.trust.OwnedDocumentLookup;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class OwnedDocumentProofs implements OwnedDocumentLookup {

    private final PersonalDocumentRepository personalDocuments;
    private final DocumentRepository documents;

    OwnedDocumentProofs(PersonalDocumentRepository personalDocuments, DocumentRepository documents) {
        this.personalDocuments = personalDocuments;
        this.documents = documents;
    }

    @Override
    @Transactional(readOnly = true)
    public boolean ownsDocument(UUID userId, UUID documentId) {
        return userId != null && documentId != null
                && (personalDocuments.existsByIdAndOwnerId(documentId, userId)
                || documents.existsOwnedPropertyVaultDocument(documentId, userId));
    }
}
