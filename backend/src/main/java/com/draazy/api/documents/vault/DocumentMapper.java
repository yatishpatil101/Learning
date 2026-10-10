package com.draazy.api.documents.vault;

import com.draazy.api.provider.FileStorage;
import java.util.List;
import org.springframework.stereotype.Component;

/** Hand-written, not MapStruct: {@code url} is minted per read by {@link FileStorage} and expires, and a generated
 * expression would hide that security-relevant line. */
@Component
public class DocumentMapper {

    private final FileStorage storage;

    public DocumentMapper(FileStorage storage) {
        this.storage = storage;
    }

    public DocumentDto toDto(Document d) {
        return new DocumentDto(
                d.getId().toString(),
                d.getPropertyId() == null ? null : d.getPropertyId().toString(),
                d.getCategory(),
                d.getFileName(),
                urlOf(d),
                d.getSizeBytes(),
                d.getMimeType(),
                d.getUploadedAt());
    }

    public List<DocumentDto> toDtos(List<Document> docs) {
        return docs.stream().map(this::toDto).toList();
    }

    public DocumentSummary toSummary(Document d) {
        return new DocumentSummary(d.getId().toString(), d.getCategory(), d.getFileName(),
                d.getSizeBytes(), d.getMimeType(), d.getUploadedAt());
    }

    public List<DocumentSummary> toSummaries(List<Document> docs) {
        return docs.stream().map(this::toSummary).toList();
    }

    public DocumentSummary toSummary(PersonalDocument d) {
        return new DocumentSummary(d.getId().toString(), d.getCategory(), d.getFileName(),
                d.getSizeBytes(), d.getMimeType(), d.getUploadedAt());
    }

    public List<DocumentSummary> toPersonalSummaries(List<PersonalDocument> docs) {
        return docs.stream().map(this::toSummary).toList();
    }

    public DocumentSummary toSummary(ManagedPropertyDocument d) {
        return new DocumentSummary(d.getId().toString(), d.getCategory(), d.getFileName(),
                d.getSizeBytes(), d.getMimeType(), d.getUploadedAt());
    }

    public List<DocumentSummary> toManagedSummaries(List<ManagedPropertyDocument> docs) {
        return docs.stream().map(this::toSummary).toList();
    }

    public String urlOf(Document d) {
        return storage.signedDownloadUrl(d.getStorageKey());
    }
}