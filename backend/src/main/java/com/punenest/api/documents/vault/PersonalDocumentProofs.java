package com.punenest.api.documents.vault;

import com.punenest.api.common.trust.PersonalDocumentLookup;
import com.punenest.api.common.trust.PersonalDocumentView;
import com.punenest.api.provider.FileStorage;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The vault's answer to {@link PersonalDocumentLookup}.
 *
 * <p>Its own component rather than a method on {@code DocumentService}: nothing here is part of the
 * upload/list/delete workflow that service exists to hold together, and the port is meant to stay
 * the narrowest possible window into the vault. A class this small is the point — whoever widens it
 * has to explain what else another context needs to know about a person's papers.
 *
 * <p><strong>Widened once, on purpose.</strong> {@link #viewOwnedBy} was added so an operator
 * reviewing a society claim could open the registration certificate attached to it, which until then
 * was a UUID nobody could dereference. It signs the URL here rather than returning the row, for the
 * reason the port's javadoc gives: a {@code storageKey} is a capability, and the only package that
 * should hold one is the one that minted it. What leaves this class is a link that expires.
 */
@Component
class PersonalDocumentProofs implements PersonalDocumentLookup {

    private final PersonalDocumentRepository documents;
    private final FileStorage storage;

    PersonalDocumentProofs(PersonalDocumentRepository documents, FileStorage storage) {
        this.documents = documents;
        this.storage = storage;
    }

    @Override
    @Transactional(readOnly = true)
    public boolean isOwnedBy(UUID documentId, UUID ownerId) {
        return documentId != null && ownerId != null
                && documents.existsByIdAndOwnerId(documentId, ownerId);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<PersonalDocumentView> viewOwnedBy(UUID documentId, UUID ownerId) {
        if (documentId == null || ownerId == null) {
            return Optional.empty();
        }
        // The owner is half the query rather than a check on the result. A findById followed by an
        // equality test reads the same, but it puts the row in a local first, and then the safety of
        // the method depends on the next person to edit it noticing that the test is load-bearing.
        return documents.findByIdAndOwnerId(documentId, ownerId)
                .map(d -> new PersonalDocumentView(
                        storage.signedDownloadUrl(d.getStorageKey()),
                        d.getFileName(),
                        d.getMimeType(),
                        // Nullable on the entity, and rows predating the size column exist. Unboxed
                        // straight into the record's long it would NPE on exactly those rows, which
                        // is a 500 on the oldest documents — the ones most likely to be disputed.
                        d.getSizeBytes() == null ? 0L : d.getSizeBytes()));
    }
}
