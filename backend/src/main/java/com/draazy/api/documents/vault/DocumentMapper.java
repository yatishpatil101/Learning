package com.draazy.api.documents.vault;

import com.draazy.api.provider.FileStorage;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Entity→wire projection for the document vault.
 *
 * <p><strong>Hand-written rather than MapStruct</strong>, unlike most mappers here. The one field
 * that matters — {@code url} — is not a projection of the row at all; it is minted per read by
 * {@link FileStorage} and deliberately expires. Expressing "call this collaborator for this field"
 * as a MapStruct {@code @Mapping(expression = ...)} would hide the single most security-relevant
 * line of the class inside generated code.
 */
@Component
public class DocumentMapper {

    private final FileStorage storage;

    public DocumentMapper(FileStorage storage) {
        this.storage = storage;
    }

    public DocumentDto toDto(Document d) {
        return new DocumentDto(
                d.getId().toString(),
                d.getPropertyId().toString(),
                d.getCategory(),
                d.getFileName(),
                storage.signedDownloadUrl(d.getStorageKey()),
                d.getSizeBytes(),
                d.getMimeType(),
                d.getUploadedAt());
    }

    public List<DocumentDto> toDtos(List<Document> docs) {
        return docs.stream().map(this::toDto).toList();
    }

    /**
     * Personal-vault projection. A {@link PersonalDocument} has no property, so the wire's
     * {@code propertyId} carries the literal {@code "personal"} — the same bucket key the front end
     * already uses ({@code getDocsForProp(mobile, 'personal')}). Reusing {@link DocumentDto} keeps
     * one document shape on the wire; the client's mapper drops the field regardless.
     */
    public DocumentDto toDto(PersonalDocument d) {
        return new DocumentDto(
                d.getId().toString(),
                "personal",
                d.getCategory(),
                d.getFileName(),
                storage.signedDownloadUrl(d.getStorageKey()),
                d.getSizeBytes(),
                d.getMimeType(),
                d.getUploadedAt());
    }

    public List<DocumentDto> toPersonalDtos(List<PersonalDocument> docs) {
        return docs.stream().map(this::toDto).toList();
    }

    /**
     * Managed-record projection (V93). Unlike the personal variant, {@code propertyId} carries a
     * real id here — the {@code managed_properties} row this file hangs off, which is the same
     * bucket key the front end already passes ({@code getDocsForProp(mobile, managedProp.id)}).
     * It is not a {@code properties} id and must not be handed to the property vault or the
     * document-request flow; the route it arrived on is what distinguishes them, not the field.
     */
    public DocumentDto toDto(ManagedPropertyDocument d) {
        return new DocumentDto(
                d.getId().toString(),
                d.getManagedPropertyId().toString(),
                d.getCategory(),
                d.getFileName(),
                storage.signedDownloadUrl(d.getStorageKey()),
                d.getSizeBytes(),
                d.getMimeType(),
                d.getUploadedAt());
    }

    public List<DocumentDto> toManagedDtos(List<ManagedPropertyDocument> docs) {
        return docs.stream().map(this::toDto).toList();
    }
}
