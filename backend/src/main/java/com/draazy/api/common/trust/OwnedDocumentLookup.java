package com.draazy.api.common.trust;

import java.util.UUID;

public interface OwnedDocumentLookup {

    boolean ownsDocument(UUID userId, UUID documentId);
}
