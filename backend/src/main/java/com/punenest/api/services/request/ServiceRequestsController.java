package com.punenest.api.services.request;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.documents.vault.DocumentDto;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * {@code /service-requests} — the assisted-service workflow.
 *
 * <p><strong>Three different guards on one resource, and the differences are the design.</strong>
 * The list, create, detail, message and document operations are caller-scoped (the service resolves
 * "mine" for a customer and "the queue" for ops). The three workflow operations are
 * {@code @PreAuthorize}'d staff/admin per {@code x-roles} (api-standards.md §6). And
 * {@code POST /{id}/draft/decision} carries <em>no</em> role annotation on purpose: it is the
 * customer's, and its guard — requester identity — is stronger than a role, because a staff-or-admin
 * check would let the maker sign off their own draft.
 *
 * <p>The uploads reuse the vault's allowlist and 10 MB ceiling
 * ({@code documents.vault.DocumentUploads}) rather than restating them, so the two upload surfaces
 * cannot drift apart.
 */
@RestController
public class ServiceRequestsController {

    private final ServiceRequestService service;

    public ServiceRequestsController(ServiceRequestService service) {
        this.service = service;
    }

    /**
     * {@code GET /service-requests} (contract {@code listServiceRequests}, spec fix S40) — paged.
     *
     * <p>Sort is stripped by {@link Pageables#unsorted(Pageable)}: newest-first is fixed server-side
     * and index-backed (V21), so an incoming {@code ?sort=} would otherwise be an unmapped-property
     * 500 that any caller could trigger with a guess.
     */
    @GetMapping(Routes.ServiceRequests.BASE)
    public PageResponse<ServiceRequestDto> list(@CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                service.list(principal, type, status, Pageables.unsorted(pageable)), dto -> dto);
    }

    /** {@code POST /service-requests} (contract {@code createServiceRequest}) — 201. */
    @PostMapping(Routes.ServiceRequests.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public ServiceRequestDto create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ServiceRequestCreate body) {
        return service.create(principal, body);
    }

    /** {@code GET /service-requests/{id}} (contract {@code getServiceRequest}). */
    @GetMapping(Routes.ServiceRequests.BY_ID)
    public ServiceRequestDto get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    /**
     * {@code PATCH /service-requests/{id}/status} (contract {@code updateServiceRequestStatus},
     * {@code x-roles: [staff, admin]}).
     */
    @PatchMapping(Routes.ServiceRequests.STATUS)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public ServiceRequestDto updateStatus(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody StatusRequest body) {
        return service.updateStatus(principal, id, body.status(), body.note());
    }

    /**
     * {@code POST /service-requests/{id}/messages} (contract {@code addServiceRequestMessage}) — 201.
     *
     * <p>{@code attachments} is accepted and dropped, as on the verification thread: the table has
     * no column for it and the {@code Message} response schema has nowhere to render one, while this
     * aggregate has a real upload surface at {@code POST /{id}/docs}. Rejecting a documented field
     * would break a client that follows the contract; dropping it silently is honest only because it
     * is written down here.
     */
    @PostMapping(Routes.ServiceRequests.MESSAGES)
    @ResponseStatus(HttpStatus.CREATED)
    public MessageDto addMessage(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody MessageRequest body) {
        return service.addMessage(principal, id, body.body());
    }

    /** {@code POST /service-requests/{id}/docs} (contract {@code addServiceRequestDoc}) — 201. */
    @PostMapping(value = Routes.ServiceRequests.DOCS,
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentDto addDoc(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestParam(value = "category", required = false) String category,
            @RequestParam("file") MultipartFile file) {
        return service.addDocument(principal, id, category, file);
    }

    /**
     * {@code POST /service-requests/{id}/draft} (contract {@code shareServiceRequestDraft},
     * spec fix S41, {@code x-roles: [staff, admin]}) — the maker's half of the maker-checker.
     */
    @PostMapping(value = Routes.ServiceRequests.DRAFT,
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public ServiceRequestDto shareDraft(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestParam(value = "note", required = false) String note,
            @RequestParam("file") MultipartFile file) {
        return service.shareDraft(principal, id, note, file);
    }

    /**
     * {@code POST /service-requests/{id}/draft/decision} (contract
     * {@code decideServiceRequestDraft}) — the checker's half.
     *
     * <p><strong>No {@code @PreAuthorize}, deliberately.</strong> The contract gives this operation
     * no {@code x-roles} because it belongs to the customer, and the service refuses anyone who is
     * not the requester — including an admin. A role guard here would be both wrong (it would lock
     * the customer out) and dangerous (it would let ops approve their own work).
     */
    @PostMapping(Routes.ServiceRequests.DRAFT_DECISION)
    public ServiceRequestDto decideDraft(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody DecisionRequest body) {
        return service.decideDraft(principal, id, body.decision(), body.note());
    }

    /**
     * {@code POST /service-requests/{id}/final-doc} (contract
     * {@code uploadServiceRequestFinalDoc}, {@code x-roles: [staff, admin]}) — 201.
     */
    @PostMapping(value = Routes.ServiceRequests.FINAL_DOC,
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentDto uploadFinalDoc(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestParam("file") MultipartFile file) {
        return service.uploadFinalDoc(principal, id, file);
    }

    /** Body of {@code updateServiceRequestStatus} (schema {@code StatusUpdate}). */
    public record StatusRequest(@NotBlank String status, @Size(max = 500) String note) {
    }

    /** Body of {@code addServiceRequestMessage} (schema {@code MessageCreate}). */
    public record MessageRequest(@NotBlank @Size(max = 4000) String body, List<String> attachments) {
    }

    /** Body of {@code decideServiceRequestDraft} (schema {@code DecisionRequest}). */
    public record DecisionRequest(@NotBlank String decision, @Size(max = 500) String note) {
    }
}
