package com.punenest.api.documents.vault;

import com.punenest.api.provider.FileStorage;
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
}
