package com.draazy.api.services.request;

import com.draazy.api.common.validation.IndianMobile;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.vault.DocumentDto;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Capabilities;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

// Caller-scoped operations and ops queue share a resource but not the same guard.
@RestController
public class ServiceRequestsController {

    private final ServiceRequestService service;

    private final ServiceRequestStaffTransitions staffTransitions;

    // Identity numbers use assignee-only authorization, unlike other request operations.
    private final ServiceRequestIdentityService identities;

    private final ServiceRequestQueryService queries;

    // Co-fill rules are requester-only for invites and invitee-only for decisions.
    private final CoFillParties parties;

    // Co-fill reorders the flow: file unpaid, collect other side, then checkout.
    private final CoFillServiceRequests coFill;

    private final ServiceRequestReadReceipts receipts;

    private final ServiceRequestDrafting drafting;
    private final ServiceRequestDocumentReviews documentReviews;
    private final ServiceRequestDraftApprovals draftApprovals;
    private final ServiceRequestDraftChecks draftChecks;

    // CANCEL is local only because this slice did not touch Routes; same constant value.
    private static final String CANCEL = Routes.ServiceRequests.BY_ID + "/cancel";

    private static final String BACK_OFFICE =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.MANAGER + "', '" + Roles.ADMIN + "')";

    private static final String QUEUE_READ =
            BACK_OFFICE + " and " + Capabilities.REQUIRE_VIEW_SERVICE_REQUESTS + " and "
                    + BackOfficePermissions.REQUIRE_SERVICES_READ;

    // Ops need queue capability; customer rows keep their caller-scoped access.
    private static final String OPS_MAY_SEE_THE_QUEUE =
            "!" + BACK_OFFICE + " or (" + QUEUE_READ + ")";

    // Ops-only routes: the desk's own reads and writes, where there is no second audience.
    private static final String SERVICES_READ =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
                    + BackOfficePermissions.REQUIRE_SERVICES_READ;

    private static final String SERVICES_WRITE =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
                    + BackOfficePermissions.REQUIRE_SERVICES_WRITE;

    public ServiceRequestsController(ServiceRequestService service,
            ServiceRequestStaffTransitions staffTransitions,
            ServiceRequestIdentityService identities,
            ServiceRequestQueryService queries,
            CoFillParties parties,
            CoFillServiceRequests coFill,
            ServiceRequestReadReceipts receipts,
            ServiceRequestDrafting drafting,
            ServiceRequestDocumentReviews documentReviews,
            ServiceRequestDraftApprovals draftApprovals,
            ServiceRequestDraftChecks draftChecks) {
        this.service = service;
        this.staffTransitions = staffTransitions;
        this.identities = identities;
        this.queries = queries;
        this.parties = parties;
        this.coFill = coFill;
        this.receipts = receipts;
        this.drafting = drafting;
        this.documentReviews = documentReviews;
        this.draftApprovals = draftApprovals;
        this.draftChecks = draftChecks;
    }

    // Strip sort: newest-first is fixed and index-backed; unmapped sort would 500.
    @GetMapping(Routes.ServiceRequests.BASE)
    @PreAuthorize(OPS_MAY_SEE_THE_QUEUE)
    public PageResponse<ServiceRequestDto> list(@CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String team,
            @RequestParam(required = false) String ticketId,
            @RequestParam(defaultValue = "false") boolean unassigned,
            @RequestParam(defaultValue = "false") boolean overdue,
            @RequestParam(defaultValue = "false") boolean mine,
            @RequestParam(required = false) String q,
            @PageableDefault(size = 20) Pageable pageable) {
        parties.claimPendingFor(principal);
        return PageResponse.of(
                queries.list(principal, type, status, team, ticketId, unassigned, overdue, mine, q,
                        Pageables.unsorted(pageable)),
                dto -> dto);
    }

    @PostMapping(Routes.ServiceRequests.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public ServiceRequestDto create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ServiceRequestCreate body) {
        return service.create(principal, body);
    }

    @PostMapping(Routes.ServiceRequests.CO_FILL_CREATE)
    @ResponseStatus(HttpStatus.CREATED)
    public ServiceRequestDto createCoFill(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody CoFillCreateRequest body) {
        return coFill.createCoFill(principal, body.request(), body.role(), body.mobile());
    }

    @GetMapping(Routes.ServiceRequests.QUEUE_SUMMARY)
    @PreAuthorize(QUEUE_READ)
    public ServiceQueueSummary queueSummary(@CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String team) {
        return queries.queueSummary(principal, team);
    }

    @GetMapping(Routes.ServiceRequests.BY_ID)
    public ServiceRequestDto get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        parties.claimPendingFor(principal);
        return service.get(principal, id);
    }

    @PutMapping(Routes.ServiceRequests.PARTY_DETAILS)
    public ServiceRequestDto submitPartyDetails(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody PartyDetailsRequest body) {
        return coFill.submitPartyDetails(principal, id, body.details());
    }

    // Contract checkout route is requester-only; service enforces participant identity.
    @PostMapping(Routes.ServiceRequests.CHECKOUT)
    public ServiceRequestDto openCheckout(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody(required = false) CheckoutRequest body) {
        return coFill.openDeferredCheckout(principal, id, body == null ? null : body.declaration());
    }

    // Checklist is customer-readable through participant identity, not role.
    // Upload routes are the only way to move items.
    @GetMapping(Routes.ServiceRequests.CHECKLIST)
    public ServiceRequestChecklistDto checklist(
            @CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return documentReviews.checklist(principal, id);
    }

    @PutMapping(Routes.ServiceRequests.CHECKLIST_ITEM)
    @PreAuthorize(SERVICES_WRITE)
    public ServiceRequestChecklistDto reviewDocument(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @PathVariable String category,
            @Valid @RequestBody DocumentReviewRequest body) {
        return documentReviews.review(principal, id, category, body.documentId(), body.verdict(),
                body.reason());
    }

    public record DocumentReviewRequest(@NotBlank @Size(max = 64) String documentId,
            @NotBlank @Size(max = 16) String verdict, @Size(max = 1000) String reason) {
    }

    @PatchMapping(Routes.ServiceRequests.STATUS)
    @PreAuthorize(SERVICES_WRITE)
    public ServiceRequestDto updateStatus(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody StatusRequest body) {
        return staffTransitions.updateStatus(principal, id, body.status(), body.note());
    }

    // attachments is documented but has no storage/response field here.
    // Dropping it preserves contract clients without pretending it renders.
    @PostMapping(Routes.ServiceRequests.MESSAGES)
    @ResponseStatus(HttpStatus.CREATED)
    public MessageDto addMessage(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody MessageRequest body) {
        return service.addMessage(principal, id, body.body());
    }

    @PostMapping(value = Routes.ServiceRequests.DOCS,
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentDto addDoc(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestParam(value = "category", required = false) String category,
            @RequestParam("file") MultipartFile file) {
        return service.addDocument(principal, id, category, file);
    }

    @PostMapping(Routes.ServiceRequests.DOCS_FROM_VAULT)
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentDto addDocFromVault(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody VaultDocFiling body) {
        return service.addDocumentFromVault(principal, id, body.documentId(), body.category());
    }

    // Participant identity, not role, protects identity-number writes.
    // Staff are refused because they could otherwise invent the parties' numbers.
    @PutMapping(Routes.ServiceRequests.IDENTITIES)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void putIdentities(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody ServiceRequestIdentitiesRequest body) {
        identities.replace(principal, id, body);
    }

    // Role guard only keeps customers off the staff route.
    // Service then limits reads to the assigned worker, admins included.
    @GetMapping(Routes.ServiceRequests.IDENTITIES)
    @PreAuthorize(SERVICES_READ)
    public List<ServiceRequestIdentityDto> getIdentities(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return identities.forAssignee(principal, id);
    }

    @PostMapping(value = Routes.ServiceRequests.DRAFT,
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize(SERVICES_WRITE)
    public ServiceRequestDto shareDraft(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestParam(value = "note", required = false) String note,
            @RequestParam(value = "checks", required = false) List<String> checks,
            @RequestParam("file") MultipartFile file) {
        return drafting.shareDraft(principal, id, note, checks, file);
    }

    // Draft decisions belong to requester; service refuses everyone else, even admins.
    @PostMapping(Routes.ServiceRequests.DRAFT_DECISION)
    public ServiceRequestDto decideDraft(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody DecisionRequest body) {
        return service.decideDraft(principal, id, body.decision(), body.note());
    }

    @PostMapping(Routes.ServiceRequests.DRAFT_OTP)
    public DraftOtpResult approveInlineDraftParty(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody DraftOtpRequest body) {
        ServiceRequest request = service.visible(principal, id);
        boolean complete = draftApprovals.confirmOtp(principal, request, body.partyKey(), body.otp());
        if (complete) {
            service.completeDraftApproval(principal, id);
            return new DraftOtpResult(true, null);
        }
        return body.otp() == null || body.otp().isBlank()
                ? new DraftOtpResult(false, draftApprovals.resendCooldownSeconds())
                : new DraftOtpResult(true, null);
    }

    @PostMapping(Routes.ServiceRequests.DRAFT_CHECK)
    @PreAuthorize(SERVICES_WRITE)
    public ServiceRequestDto checkDraft(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody DraftCheckRequest body) {
        return draftChecks.decide(principal, id, body.decision(), body.note());
    }

    @PostMapping(value = Routes.ServiceRequests.FINAL_DOC,
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize(SERVICES_WRITE)
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentDto uploadFinalDoc(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestParam("file") MultipartFile file, @ModelAttribute RegistrationParticulars registration) {
        return drafting.uploadFinalDoc(principal, id, file, registration);
    }

    @PostMapping(CANCEL)
    public ServiceRequestDto cancel(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.cancelUnpaid(principal, id);
    }

    // Counterparty naming grants read access, so it is a customer act, not support.
    @PostMapping(Routes.ServiceRequests.PARTIES)
    @ResponseStatus(HttpStatus.CREATED)
    public ServiceRequestPartyDto inviteParty(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody PartyInvite body) {
        return parties.invite(principal, id, body.role(), body.partyIndexOrDefault(), body.mobile());
    }

    // 204 because withdrawal undoes an invite; caller is not reading a replacement list.
    @DeleteMapping(Routes.ServiceRequests.PARTY_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdrawParty(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @PathVariable String partyId) {
        parties.withdraw(principal, id, partyId);
    }

    @PostMapping(Routes.ServiceRequests.READ)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        receipts.markRead(principal, id);
    }

    @PostMapping(Routes.ServiceRequests.DRAFT_OPENED)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markDraftOpened(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        receipts.markDraftOpened(principal, id);
    }

    // Shared status schema cannot require note only for cancellation; enforce it here.
    public record StatusRequest(@NotBlank String status, @Size(max = 500) String note) {

        @AssertTrue(message = "say why this request is being cancelled")
        public boolean isCancellationExplained() {
            return !"cancelled".equalsIgnoreCase(status == null ? "" : status.trim())
                    || (note != null && !note.isBlank());
        }
    }

    public record MessageRequest(@NotBlank @Size(max = 4000) String body, List<String> attachments) {
    }

    public record DecisionRequest(@NotBlank String decision, @Size(max = 500) String note) {
    }

    public record DraftOtpRequest(@NotBlank String partyKey, @Size(min = 6, max = 6) String otp) {
    }

    public record DraftOtpResult(boolean approvalRecorded, Integer resendAfterSeconds) {
    }

    public record DraftCheckRequest(@NotBlank String decision, @Size(max = 500) String note) {
    }

    public record PartyInvite(@NotBlank String role, Integer partyIndex,
            @NotBlank @IndianMobile String mobile) {
        int partyIndexOrDefault() {
            return partyIndex == null ? 0 : partyIndex;
        }
    }

    public record CoFillCreateRequest(@NotNull @Valid ServiceRequestCreate request,
            @NotBlank String role,
            @NotBlank @IndianMobile String mobile) {
    }

    public record PartyDetailsRequest(@NotNull Map<String, Object> details) {
    }

    public record CheckoutRequest(@Size(max = 64) String declaration) {
    }

    public record VaultDocFiling(@NotBlank String documentId, @Size(max = 64) String category) {
    }
}
