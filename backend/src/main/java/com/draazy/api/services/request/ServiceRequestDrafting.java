package com.draazy.api.services.request;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.documents.vault.DocumentDto;
import com.draazy.api.security.AuthPrincipal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ServiceRequestDrafting {

    private static final String DRAFT = "draft";
    private static final String FINAL_DOCUMENT = "final-document";

    private final ServiceRequestService requests;
    private final ServiceRequestMapper mapper;
    private final RentAgreementRegistration registration;
    private final ServiceRequestRegistrationRepository registrations;
    private final AuditService audit;
    private final Notifier notifier;
    private final ServiceRequestDocumentReviews documentReviews;
    private final ServiceRequestAmendments amendments;
    private final ServiceRequestDraftApprovals approvals;
    private final ServiceRequestDraftChecks draftChecks;

    public ServiceRequestDrafting(ServiceRequestService requests, ServiceRequestMapper mapper,
            RentAgreementRegistration registration, ServiceRequestRegistrationRepository registrations,
            AuditService audit, Notifier notifier, ServiceRequestDocumentReviews documentReviews,
            ServiceRequestAmendments amendments, ServiceRequestDraftApprovals approvals,
            ServiceRequestDraftChecks draftChecks) {
        this.requests = requests;
        this.mapper = mapper;
        this.registration = registration;
        this.registrations = registrations;
        this.audit = audit;
        this.notifier = notifier;
        this.documentReviews = documentReviews;
        this.amendments = amendments;
        this.approvals = approvals;
        this.draftChecks = draftChecks;
    }

    // Notify requester in the transaction; only they can decide, so silence stalls both sides.
    @Transactional
    public ServiceRequestDto shareDraft(AuthPrincipal caller, String id, String note,
            List<String> checks, MultipartFile file) {
        ServiceRequest request = requests.opsAccessible(caller, id);
        requests.requireHolder(caller, request, "sharing a draft", "the draft is theirs to share");
        List<String> attested = DraftingChecklist.require(request, checks);
        documentReviews.requireVerified(caller, request, "sharing the draft");
        amendments.requireNoneOpen(request);
        if (!request.getStatus().canTransitionTo(ServiceRequestStatus.DRAFT_SHARED)) {
            throw new ConflictException("This request is " + request.getStatus()
                    + " — no draft can be shared from here.");
        }
        requests.storeDocument(caller, request, DRAFT, file, null);
        int version = approvals.currentVersion(request);
        if (draftChecks.holdIfRisky(caller, request, version)) {
            return mapper.toDto(request, caller);
        }
        ServiceRequestStatus from = requests.transition(request, ServiceRequestStatus.DRAFT_SHARED);
        requests.record(request, ServiceRequestReadReceipts.DRAFT_SHARED, requests.displayName(caller.userId()));
        audit.record(caller, "service-request.draft-shared", "service_request",
                request.getId().toString(), "from", from.wire(), "note", note,
                "checks", String.join(",", attested));
        notifier.notify(request.getRequesterId(), "service.draft-shared",
                "Your draft is ready to review",
                "Our team has shared a draft with you. Approve it, or ask for changes.",
                ServiceRequestTypes.pageFor(request.getType()));
        return mapper.toDto(request, caller);
    }

    // Final upload completes only from approved, held requests.
    // Rent agreements draft tenancy rows; a second operator verifies before trust badges.
    @Transactional
    public DocumentDto uploadFinalDoc(AuthPrincipal caller, String id, MultipartFile file,
            RegistrationParticulars particulars) {
        ServiceRequest request = requests.opsAccessible(caller, id);
        if (request.getStatus() != ServiceRequestStatus.APPROVED) {
            throw new ConflictException(
                    "The customer has not approved the draft yet \u2014 this request is "
                            + request.getStatus() + ".");
        }
        requests.requireHolder(caller, request, "uploading the registered copy",
                "the registered copy is theirs to upload");
        documentReviews.requireVerified(caller, request, "uploading the registered copy");
        RegistrationParticulars.Valid record = registrationRecord(request, particulars);
        DocumentDto uploaded = requests.storeDocument(
                caller, request, FINAL_DOCUMENT, file, "final-document.uploaded");
        requests.transition(request, ServiceRequestStatus.COMPLETED);
        requests.record(request, "status.completed", requests.displayName(caller.userId()));
        registration.prepare(caller, request, UUID.fromString(uploaded.id()));
        if (record == null) {
            audit.record(caller, "service-request.completed", "service_request",
                    request.getId().toString(), "document", uploaded.id());
        } else {
            registrations.save(new ServiceRequestRegistration(request.getId(), record, caller.userId()));
            audit.record(caller, "service-request.completed", "service_request",
                    request.getId().toString(), "document", uploaded.id(),
                    "documentNo", record.documentNo(), "sro", record.sro(), "grn", record.grn());
        }
        return uploaded;
    }

    private RegistrationParticulars.Valid registrationRecord(ServiceRequest request,
            RegistrationParticulars particulars) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            return null;
        }
        RegistrationParticulars.Valid record = (particulars == null
                ? new RegistrationParticulars(null, null, null, null, null, null) : particulars).validate(LocalDate.now(PlatformTime.IST),
                        LocalDate.ofInstant(request.getCreatedAt(), PlatformTime.IST));
        if (registrations.grnRecorded(record.grn())) {
            throw new ConflictException("GRAS challan " + record.grn()
                    + " is already recorded against another agreement \u2014 one challan pays for one document.");
        }
        if (registrations.documentRecorded(record.sro(), record.documentNo(), record.registeredOn().getYear())) {
            throw new ConflictException("Document " + record.documentNo() + " at " + record.sro()
                    + " is already recorded against another agreement.");
        }
        return record;
    }

    static String customerCategory(ServiceRequest request, String category) {
        if (request.getStatus().isTerminal()) {
            throw new ConflictException(
                    "This request is " + request.getStatus() + " \u2014 start a new one to continue.");
        }
        String wanted = category == null ? "" : category.strip();
        if (DRAFT.equals(wanted) || FINAL_DOCUMENT.equals(wanted)) {
            throw new ValidationException("Drafts and the registered copy are filed by our team.");
        }
        return wanted.isEmpty() ? "service-request" : wanted;
    }
}
