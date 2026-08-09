package com.punenest.api.documents.vault;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * The owner's document vault at {@code /me/documents/{propId}}.
 *
 * <p>No role guard, for the same reason as {@code MeListingsController} and
 * {@code MeContactRequestsController}: the contract carries no {@code x-roles} here, and any
 * signed-in user becomes an owner the moment they post a listing. Authentication plus strict
 * owner-scoping in {@link DocumentService} is the gate.
 *
 * <p>A bare array, not a {@code PageResponse}, because the contract says so — and it is right to:
 * a property's paperwork is a handful of files, and the growth limit is how many documents a flat
 * legally has (api-standards.md §5.1).
 */
@RestController
public class MeDocumentsController {

    private final DocumentService documentService;

    public MeDocumentsController(DocumentService documentService) {
        this.documentService = documentService;
    }

    /** {@code GET /me/documents/{propId}} (contract {@code listDocuments}). */
    @GetMapping(Routes.MeDocuments.FOR_PROPERTY)
    public List<DocumentDto> listDocuments(@CurrentUser AuthPrincipal principal,
            @PathVariable("propId") String propId) {
        return documentService.list(principal.userId(), propId);
    }

    /**
     * {@code POST /me/documents/{propId}} (contract {@code uploadDocument}) — multipart upload.
     *
     * <p>{@code consumes} is pinned to {@code multipart/form-data} deliberately. Without it a JSON
     * body would reach the handler and fail on a missing part with a 400 that says nothing useful;
     * with it, the wrong content type is refused as a 415 by Spring before any of our code runs,
     * which is the same answer {@link DocumentUploads} gives for the wrong <em>file</em> type.
     */
    @PostMapping(value = Routes.MeDocuments.FOR_PROPERTY, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentDto uploadDocument(@CurrentUser AuthPrincipal principal,
            @PathVariable("propId") String propId,
            @RequestParam("category") String category,
            @RequestParam("file") MultipartFile file) {
        return documentService.upload(principal.userId(), propId, category, file);
    }

    /** {@code DELETE /me/documents/{propId}/{docId}} (contract {@code deleteDocument}). */
    @DeleteMapping(Routes.MeDocuments.BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteDocument(@CurrentUser AuthPrincipal principal,
            @PathVariable("propId") String propId, @PathVariable("docId") String docId) {
        documentService.delete(principal.userId(), propId, docId);
    }

    /**
     * {@code GET /me/documents/personal} — the caller's own KYC papers.
     *
     * <p>The {@code personal} segment is a literal, so it out-ranks the {@code {propId}} template of
     * {@link #listDocuments} and resolves here; a property can never be addressed as {@code personal}
     * (the same mechanism that keeps {@code /me/documents/requests} out of the vault).
     */
    @GetMapping(Routes.MeDocuments.PERSONAL)
    public List<DocumentDto> listPersonalDocuments(@CurrentUser AuthPrincipal principal) {
        return documentService.listPersonal(principal.userId());
    }

    /** {@code POST /me/documents/personal} — multipart upload of one KYC file. */
    @PostMapping(value = Routes.MeDocuments.PERSONAL, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentDto uploadPersonalDocument(@CurrentUser AuthPrincipal principal,
            @RequestParam("category") String category,
            @RequestParam("file") MultipartFile file) {
        return documentService.uploadPersonal(principal.userId(), category, file);
    }

    /** {@code DELETE /me/documents/personal/{docId}} — remove one of the caller's KYC files. */
    @DeleteMapping(Routes.MeDocuments.PERSONAL_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deletePersonalDocument(@CurrentUser AuthPrincipal principal,
            @PathVariable("docId") String docId) {
        documentService.deletePersonal(principal.userId(), docId);
    }
}
