package com.draazy.api.documents.vault;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
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
 * Owner document vault at {@code /me/documents/{propId}}. No role guard by design; auth plus
 * owner-scoping in {@link DocumentService} is the gate. Returns a bare array per contract.
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
     * {@code POST /me/documents/{propId}} — multipart upload. {@code consumes} pinned so Spring
     * rejects a wrong content type as 415 before our code runs.
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
        documentService.delete(principal, propId, docId);
    }

    /**
     * {@code GET /me/documents/personal} — the caller's own KYC papers. Literal segment out-ranks
     * the {@code {propId}} template.
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

    /**
     * {@code GET /me/documents/managed/{managedId}} — one managed record's papers. Literal segment
     * out-ranks the {@code {propId}} template; the id selects which vault.
     */
    @GetMapping(Routes.MeDocuments.FOR_MANAGED)
    public List<DocumentDto> listManagedDocuments(@CurrentUser AuthPrincipal principal,
            @PathVariable("managedId") String managedId) {
        return documentService.listManaged(principal.userId(), managedId);
    }

    /** {@code POST /me/documents/managed/{managedId}} — multipart upload of one paper. */
    @PostMapping(value = Routes.MeDocuments.FOR_MANAGED,
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentDto uploadManagedDocument(@CurrentUser AuthPrincipal principal,
            @PathVariable("managedId") String managedId,
            @RequestParam("category") String category,
            @RequestParam("file") MultipartFile file) {
        return documentService.uploadManaged(principal.userId(), managedId, category, file);
    }

    /** {@code DELETE /me/documents/managed/{managedId}/{docId}} — remove one paper. */
    @DeleteMapping(Routes.MeDocuments.MANAGED_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteManagedDocument(@CurrentUser AuthPrincipal principal,
            @PathVariable("managedId") String managedId, @PathVariable("docId") String docId) {
        documentService.deleteManaged(principal.userId(), managedId, docId);
    }
}
