package com.punenest.api.services.request;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Ids;
import com.punenest.api.documents.vault.DocumentDto;
import com.punenest.api.documents.vault.DocumentService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

/**
 * The assisted-service workflow: a customer asks, ops does the work, ops shares a draft, and the
 * customer accepts it before anything is registered.
 *
 * <p><strong>The maker-checker is the security of this class.</strong> Ops is the maker — it assigns,
 * works and shares the draft. The customer is the checker — {@link #decideDraft} is the <em>only</em>
 * way to reach {@code approved}, and only the requester may call it. Three things protect that:
 *
 * <ol>
 *   <li>{@link ServiceRequestStatuses#isStaffSettable} keeps {@code approved}, {@code draft-shared}
 *       and {@code completed} out of reach of {@code PATCH /status} — a status endpoint that could
 *       set them would let a staff member mark a job approved and finished without ever producing
 *       a document;</li>
 *   <li>{@link #decideDraft} rejects a staff caller outright, even an admin, so nobody can approve
 *       their own draft;</li>
 *   <li>{@code completed} is reachable only from {@code approved}, and only by uploading the file —
 *       so "done" always has a document behind it.</li>
 * </ol>
 *
 * <p><strong>Visibility is by lookup, and a miss is a 404.</strong> A customer reading somebody
 * else's request gets "not found" rather than "forbidden": a 403 would confirm that a particular
 * person has a particular legal matter open, which is exactly the fact worth hiding.
 *
 * <p>Every staff transition writes both a timeline entry (what the customer reads) and an audit row
 * (who is accountable). They are not redundant — see {@link ServiceRequestEvent}.
 */
@Service
public class ServiceRequestService {

    /**
     * Serialized-size ceiling for {@code details}, restoring the bound the old flat-string schema had
     * (D119: it was {@code @Size(4000)}). The field is now a free-form {@code jsonb} object reachable
     * by any authenticated caller and written verbatim, so an unbounded object is a storage-growth
     * vector; the cap is measured on the serialized JSON — the form actually persisted — mirroring
     * {@code SavedSearchService.serializeFilters}, and is generous over the old 4000 to allow the
     * object's own keys and structure.
     */
    private static final int DETAILS_MAX_CHARS = 8000;

    private final ServiceRequestRepository requests;
    private final ServiceRequestEventRepository events;
    private final ServiceRequestMessageRepository messages;
    private final ServiceRequestMapper mapper;
    private final DocumentService documents;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final AuditService audit;
    private final ObjectMapper objectMapper;

    public ServiceRequestService(ServiceRequestRepository requests,
            ServiceRequestEventRepository events,
            ServiceRequestMessageRepository messages,
            ServiceRequestMapper mapper,
            DocumentService documents,
            UserRepository users,
            PropertyRepository properties,
            AuditService audit,
            ObjectMapper objectMapper) {
        this.requests = requests;
        this.events = events;
        this.messages = messages;
        this.mapper = mapper;
        this.documents = documents;
        this.users = users;
        this.properties = properties;
        this.audit = audit;
        this.objectMapper = objectMapper;
    }

    /**
     * Contract {@code listServiceRequests} (spec fix S40) — own for a customer, the queue for ops.
     *
     * <p>The scope is derived from the principal's role, never from a parameter. There is no
     * {@code ?requesterId=} for the same reason there is no nullable scope on the repository: a
     * filter a client can set is a filter a client can remove.
     */
    @Transactional(readOnly = true)
    public Page<ServiceRequestDto> list(AuthPrincipal caller, String type, String status,
            Pageable pageable) {
        String typeFilter = blankToNull(type);
        String statusFilter = blankToNull(status);
        if (statusFilter != null && !ServiceRequestStatuses.isKnown(statusFilter)) {
            throw new BadRequestException("Unknown service request status: " + statusFilter);
        }
        Page<ServiceRequest> page = isOps(caller)
                ? requests.findForQueue(typeFilter, statusFilter, pageable)
                : requests.findForRequester(caller.userId(), typeFilter, statusFilter, pageable);
        // One mapper call for the whole page — see ServiceRequestMapper on why this is not a .map().
        List<ServiceRequestDto> content = mapper.toDtos(page.getContent());
        return new PageImpl<>(content, page.getPageable(), page.getTotalElements());
    }

    /** Contract {@code createServiceRequest} — 201. Any authenticated caller, for themselves. */
    @Transactional
    public ServiceRequestDto create(AuthPrincipal caller, ServiceRequestCreate body) {
        UUID propertyId = body.propertyId() == null || body.propertyId().isBlank()
                ? null
                : Ids.parseUuid(body.propertyId())
                        .orElseThrow(() -> new BadRequestException("propertyId must be a valid id"));
        // The listing has to exist: property_id is a foreign key (V7), so an unchecked id is a
        // constraint violation rather than an answer, and every document uploaded to this request
        // inherits it. A well-formed id for no listing is a 404, a malformed one a 400 -- they are
        // different mistakes. Existence is all that is checked: a service request is routinely
        // raised by a tenant or a buyer, so ownership is the wrong question. What stops that
        // becoming a way to push files into a stranger's vault is that property-scoped document
        // reads exclude service-request rows; see DocumentRepository.
        if (propertyId != null && !properties.existsById(propertyId)) {
            throw NotFoundException.of("Property");
        }

        Map<String, Object> details = boundedDetails(body.details());
        ServiceRequest request = requests.saveAndFlush(new ServiceRequest(
                caller.userId(), body.type().trim(), propertyId, details));
        // saveAndFlush: @UuidGenerator/@CreationTimestamp populate at INSERT, and the timeline entry
        // below needs the id.
        record(request, "request.created", displayName(caller.userId()));
        return mapper.toDto(request);
    }

    /**
     * Reject a {@code details} object whose serialized form exceeds {@link #DETAILS_MAX_CHARS}.
     *
     * <p>The old flat-string schema capped this at 4000 chars ({@code @Size}); {@code @Size} cannot
     * bound a {@code Map}, so the ceiling is re-established here on the serialized JSON — the form
     * actually stored — exactly as {@code SavedSearchService.serializeFilters} does. A null or empty
     * object passes through untouched — "no structured detail" is a valid request.
     */
    private Map<String, Object> boundedDetails(Map<String, Object> details) {
        if (details == null || details.isEmpty()) {
            return details;
        }
        String json;
        try {
            json = objectMapper.writeValueAsString(details);
        } catch (RuntimeException unserializable) {
            // Jackson 3 throws unchecked; a body that will not serialize cannot be stored as jsonb.
            throw new BadRequestException("details must be a serializable object");
        }
        if (json.length() > DETAILS_MAX_CHARS) {
            throw new BadRequestException(
                    "details is too large (max " + DETAILS_MAX_CHARS + " characters)");
        }
        return details;
    }

    /** Contract {@code getServiceRequest} — the requester or ops. */
    @Transactional(readOnly = true)
    public ServiceRequestDto get(AuthPrincipal caller, String id) {
        return mapper.toDto(visible(caller, id));
    }

    /**
     * Contract {@code addServiceRequestMessage} — 201. The requester or ops.
     *
     * <p>{@code authorRole} is taken from the principal, so a customer cannot post as staff.
     */
    @Transactional
    public MessageDto addMessage(AuthPrincipal caller, String id, String body) {
        ServiceRequest request = visible(caller, id);
        if (ServiceRequestStatuses.isTerminal(request.getStatus())) {
            throw new ConflictException(
                    "This request is " + request.getStatus() + " — start a new one to continue.");
        }
        return mapper.toMessageDto(messages.saveAndFlush(new ServiceRequestMessage(
                request.getId(), caller.userId(), caller.role(), body)));
    }

    /**
     * Contract {@code updateServiceRequestStatus} — staff/admin.
     *
     * <p>Only the three <em>administrative</em> statuses are settable here; the three that mean
     * something happened are earned by it happening. Moving to {@code assigned} takes the request
     * for the calling staff member — assignment and acknowledgement are the same act, and a queue
     * where you can assign work to somebody else by id is a queue people dump work into.
     *
     * @throws BadRequestException if the target status is unknown or not staff-settable
     * @throws ConflictException   if the transition is illegal from where the request is now
     */
    @Transactional
    public ServiceRequestDto updateStatus(AuthPrincipal caller, String id, String status, String note) {
        ServiceRequest request = found(id);
        String target = status == null ? "" : status.trim();
        if (!ServiceRequestStatuses.isKnown(target)) {
            throw new BadRequestException("Unknown service request status: " + status);
        }
        if (!ServiceRequestStatuses.isStaffSettable(target)) {
            throw new BadRequestException(
                    ("'%s' is not set directly. Share a draft to reach draft-shared, the customer "
                            + "approves it, and uploading the final document completes it.")
                            .formatted(target));
        }
        String from = transition(request, target);
        if (ServiceRequestStatuses.ASSIGNED.equals(target)) {
            request.setAssigneeId(caller.userId());
        }
        String actor = displayName(caller.userId());
        record(request, "status." + target, actor);
        audit.record(caller, "service-request.status", "service_request", request.getId().toString(),
                "from", from, "to", target, "note", note);
        return mapper.toDto(request);
    }

    /**
     * Contract {@code addServiceRequestDoc} — 201. The requester or ops.
     *
     * <p>The request must be about a property. {@code documents.property_id} is {@code NOT NULL}
     * (V20) because a document in this platform is always about a flat, so a general enquiry with
     * no listing has nowhere to put one. Refusing with a 409 that says so beats either a null column
     * or a 500 from the constraint.
     *
     * @throws ConflictException if the request carries no property, or is already closed
     */
    @Transactional
    public DocumentDto addDocument(AuthPrincipal caller, String id, String category,
            MultipartFile file) {
        ServiceRequest request = visible(caller, id);
        return storeDocument(caller, request, category == null || category.isBlank()
                ? "service-request" : category, file, "document.uploaded");
    }

    /**
     * Contract {@code shareServiceRequestDraft} (spec fix S41) — staff/admin. The maker's half.
     *
     * <p>Reachable from {@code assigned}, {@code in-progress} and {@code draft-shared} itself: a
     * revised draft after the customer asked for changes is the same act done twice, not a special
     * case. The file lands in the vault under the {@code draft} category, so the newest-first list
     * of them is the version history — the contract has no version field and inventing one would be
     * schema nobody asked for.
     */
    @Transactional
    public ServiceRequestDto shareDraft(AuthPrincipal caller, String id, String note,
            MultipartFile file) {
        ServiceRequest request = found(id);
        String from = transition(request, ServiceRequestStatuses.DRAFT_SHARED);
        storeDocument(caller, request, "draft", file, "draft.shared");
        audit.record(caller, "service-request.draft-shared", "service_request",
                request.getId().toString(), "from", from, "note", note);
        return mapper.toDto(request);
    }

    /**
     * Contract {@code decideServiceRequestDraft} — <strong>the requester, and nobody else</strong>.
     *
     * <p>Staff and admin are refused here even though they can do everything else on the request.
     * That is the entire maker-checker: the person who produced the draft must not be the person
     * who accepts it, and "admin can do anything" would quietly delete the control. A rejection is
     * not a failure state — it returns the request to {@code in-progress}, which is where the work
     * is, and the customer's note goes on the timeline so ops can see what to change.
     *
     * @throws ForbiddenException if the caller is not the requester
     * @throws ConflictException  if there is no draft outstanding
     */
    @Transactional
    public ServiceRequestDto decideDraft(AuthPrincipal caller, String id, String decision,
            String note) {
        ServiceRequest request = found(id);
        if (!caller.userId().equals(request.getRequesterId())) {
            throw new ForbiddenException(
                    "Only the person who raised this request can approve or reject the draft.");
        }
        boolean approve = switch (decision == null ? "" : decision.trim().toLowerCase()) {
            case "approve" -> true;
            case "reject" -> false;
            default -> throw new BadRequestException("decision must be 'approve' or 'reject'");
        };
        String target = approve ? ServiceRequestStatuses.APPROVED : ServiceRequestStatuses.IN_PROGRESS;
        if (!ServiceRequestStatuses.DRAFT_SHARED.equals(request.getStatus())) {
            throw new ConflictException(
                    "There is no draft awaiting your decision — this request is "
                            + request.getStatus() + ".");
        }
        String from = transition(request, target);
        record(request, approve ? "draft.approved" : "draft.rejected", displayName(caller.userId()));
        audit.record(caller, "service-request.draft-decision", "service_request",
                request.getId().toString(), "from", from, "to", target, "note", note);
        return mapper.toDto(request);
    }

    /**
     * Contract {@code uploadServiceRequestFinalDoc} — 201. Staff/admin.
     *
     * <p>Only from {@code approved}, and it is what completes the request. Tying completion to the
     * arrival of the file means a completed request always has the registered document behind it.
     */
    @Transactional
    public DocumentDto uploadFinalDoc(AuthPrincipal caller, String id, MultipartFile file) {
        ServiceRequest request = found(id);
        if (!ServiceRequestStatuses.APPROVED.equals(request.getStatus())) {
            throw new ConflictException(
                    "The customer has not approved the draft yet — this request is "
                            + request.getStatus() + ".");
        }
        DocumentDto uploaded =
                storeDocument(caller, request, "final-document", file, "final-document.uploaded");
        transition(request, ServiceRequestStatuses.COMPLETED);
        record(request, "status.completed", displayName(caller.userId()));
        audit.record(caller, "service-request.completed", "service_request",
                request.getId().toString(), "document", uploaded.id());
        return uploaded;
    }

    // ---------------------------------------------------------------- internals

    /**
     * Upload one file against the request and narrate it.
     *
     * <p>The property check lives here rather than at each call site so that no upload path can
     * forget it — see {@link #addDocument} for why a request without a property cannot hold one.
     */
    private DocumentDto storeDocument(AuthPrincipal caller, ServiceRequest request, String category,
            MultipartFile file, String event) {
        if (request.getPropertyId() == null) {
            throw new ConflictException(
                    "This request is not linked to a property, so documents cannot be attached to it.");
        }
        if (file == null || file.isEmpty()) {
            throw new BadRequestException("Attach a file to upload.");
        }
        DocumentDto dto = documents.uploadForServiceRequest(
                request.getPropertyId(), request.getId(), category, file);
        record(request, event, displayName(caller.userId()));
        return dto;
    }

    /** Apply a transition or refuse it, returning the status moved from. */
    private String transition(ServiceRequest request, String target) {
        String from = request.getStatus();
        if (!ServiceRequestStatuses.canTransition(from, target)) {
            throw new ConflictException(
                    "Cannot move a service request from %s to %s.".formatted(from, target));
        }
        request.moveTo(target);
        return from;
    }

    private void record(ServiceRequest request, String event, String by) {
        events.save(new ServiceRequestEvent(request.getId(), event, by));
    }

    /** Any existing request. Used by the ops-only operations, whose role guard is the controller's. */
    private ServiceRequest found(String id) {
        return Ids.parseUuid(id)
                .flatMap(requests::findById)
                .orElseThrow(() -> NotFoundException.of("Service request"));
    }

    /** The requester's own request, or any request for ops. A stranger's is a 404, not a 403. */
    private ServiceRequest visible(AuthPrincipal caller, String id) {
        ServiceRequest request = found(id);
        if (!isOps(caller) && !caller.userId().equals(request.getRequesterId())) {
            throw NotFoundException.of("Service request");
        }
        return request;
    }

    private static boolean isOps(AuthPrincipal caller) {
        return Roles.Wire.STAFF.equals(caller.role()) || Roles.Wire.ADMIN.equals(caller.role());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /** The narration name. Null-safe: a removed user leaves the timeline entry unattributed. */
    private String displayName(UUID userId) {
        return users.findById(userId).map(User::getName).orElse(null);
    }
}
