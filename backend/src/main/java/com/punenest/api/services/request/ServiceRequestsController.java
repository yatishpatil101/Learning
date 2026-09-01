package com.punenest.api.services.request;

import com.punenest.api.common.validation.IndianMobile;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.documents.vault.DocumentDto;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.Capabilities;
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
import org.springframework.web.bind.annotation.PutMapping;
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

    /**
     * The identity-number channel (D151). A separate collaborator rather than more methods on
     * {@link ServiceRequestService}, because its authorisation rule is unlike anything else on this
     * resource — not a role and not the requester, but the one person the request is assigned to —
     * and folding it in would have hidden that among nine methods that all resolve "ops or the
     * customer".
     */
    private final ServiceRequestIdentityService identities;

    /**
     * The read side (D44/D45). Split out of {@link ServiceRequestService} for the same reason as
     * {@link #identities}: the queue's authorisation rule is desk scoping, which has nothing to do
     * with the payment state machine the write side is.
     */
    private final ServiceRequestQueryService queries;

    /**
     * The co-fill counterparty (D121). Its own collaborator for the same reason as
     * {@link #identities}: the invite's authorisation rule is "the requester and nobody else", and
     * the decision's is "the invited person and nobody else" — a third and fourth model on a
     * resource whose other nine methods all resolve "ops or the customer".
     */
    private final CoFillParties parties;

    /** Read receipts on the conversation (D121). */
    private final ServiceRequestReadReceipts receipts;

    /**
     * {@code POST /service-requests/{id}/cancel} — the customer's escape from an abandoned checkout
     * (D152).
     *
     * <p>Composed from {@link Routes.ServiceRequests#BY_ID} here rather than declared in
     * {@code Routes} alongside its siblings, which is where it belongs and where it should be moved:
     * it is left local only because this change could not touch that file. Both forms are the same
     * compile-time constant, so the annotation and every test resolve to one string either way.
     */
    private static final String CANCEL = Routes.ServiceRequests.BY_ID + "/cancel";

    /**
     * The one guard on this controller that is a capability rather than a role (tech debt D67).
     *
     * <p>Read it as "if you are ops, you need {@code view_service_requests}" — the negated role test
     * short-circuits for everybody else, so a customer's own list is reached on exactly the terms it
     * always was. It has to be written that way round because {@link #list} is <em>one</em> route
     * serving two audiences: the service picks the queue or the caller's own rows from the
     * principal's role, so the capability is only meaningful on the branch the role test selects.
     * Composed with {@code or} rather than {@code and} for that reason alone; it still cannot widen
     * anything, because the only callers it can turn away are ones the ops branch would have served.
     */
    private static final String OPS_MAY_SEE_THE_QUEUE =
            "!hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') or ("
                    + Capabilities.REQUIRE_VIEW_SERVICE_REQUESTS + " and "
                    + BackOfficePermissions.REQUIRE_SERVICES_READ + ")";

    /**
     * Ops-only routes: the desk's own reads and writes, where there is no second audience.
     *
     * <p>Plain {@code and} here, unlike the fragment above, because these routes have exactly one
     * kind of caller. Both atoms sit alongside {@link Capabilities}, which is a different axis and
     * is stored separately — the capability says what this ops account was hired to do, the atom
     * says what this particular administrator narrowed them to.
     */
    private static final String SERVICES_READ =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
                    + BackOfficePermissions.REQUIRE_SERVICES_READ;

    /** @see #SERVICES_READ */
    private static final String SERVICES_WRITE =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
                    + BackOfficePermissions.REQUIRE_SERVICES_WRITE;

    public ServiceRequestsController(ServiceRequestService service,
            ServiceRequestIdentityService identities,
            ServiceRequestQueryService queries,
            CoFillParties parties,
            ServiceRequestReadReceipts receipts) {
        this.service = service;
        this.identities = identities;
        this.queries = queries;
        this.parties = parties;
        this.receipts = receipts;
    }

    /**
     * {@code GET /service-requests} (contract {@code listServiceRequests}, spec fix S40) — paged.
     *
     * <p>Sort is stripped by {@link Pageables#unsorted(Pageable)}: newest-first is fixed server-side
     * and index-backed (V21), so an incoming {@code ?sort=} would otherwise be an unmapped-property
     * 500 that any caller could trigger with a guess.
     *
     * <p>The guard is {@link #OPS_MAY_SEE_THE_QUEUE}: no role is required to read your own requests,
     * and the capability is required to read everybody's.
     *
     * <p>{@code team} narrows an admin's view to one desk (D44); a staff caller's is already pinned
     * to their own and naming another is a 403. {@code ticketId} answers "which request came off this
     * board item" (D45) — the direction of the link that {@code ServiceRequest.ticketId} does not
     * serve, so an operator holding a ticket does not have to match it to a request by hand.
     */
    @GetMapping(Routes.ServiceRequests.BASE)
    @PreAuthorize(OPS_MAY_SEE_THE_QUEUE)
    public PageResponse<ServiceRequestDto> list(@CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String team,
            @RequestParam(required = false) String ticketId,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                queries.list(principal, type, status, team, ticketId, Pageables.unsorted(pageable)),
                dto -> dto);
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
     * {@code GET /service-requests/{id}/checklist} (contract {@code getServiceRequestChecklist}) —
     * the named paperwork this request needs and what has arrived (D120).
     *
     * <p>No role annotation, by design: the customer is the person this is for, and the guard is
     * participant identity inside {@code ServiceRequestService.checklist} — a request that is not
     * the caller's is {@code 404}, not {@code 403}. Read-only; the only way to move an item is to
     * upload the document, which is {@link Routes.ServiceRequests#DOCS}.
     */
    @GetMapping(Routes.ServiceRequests.CHECKLIST)
    public ServiceRequestChecklistDto checklist(
            @CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.checklist(principal, id);
    }

    /**
     * {@code PATCH /service-requests/{id}/status} (contract {@code updateServiceRequestStatus},
     * {@code x-roles: [staff, admin]}).
     */
    @PatchMapping(Routes.ServiceRequests.STATUS)
    @PreAuthorize(SERVICES_WRITE)
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
     * {@code PUT /service-requests/{id}/identities} (contract {@code putServiceRequestIdentities})
     * — 204. The requester's, and nobody else's (D151).
     *
     * <p><strong>No {@code @PreAuthorize}, deliberately</strong>, and for the same reason as the
     * draft decision: the guard is participant identity, which is stronger than a role. A staff
     * caller is refused by the service — a desk that could write the parties' identity numbers could
     * also invent them, and the agreement would then name somebody the customer never identified.
     *
     * <p>{@code PUT} rather than {@code POST} because the body is the complete set: the wizard
     * resubmits every party when the customer corrects one, and append semantics would leave the
     * mistyped number behind. 204 rather than the recorded set, because echoing identity numbers
     * onto a response that nobody reads them from is exactly the habit that made {@code details} a
     * leak.
     */
    @PutMapping(Routes.ServiceRequests.IDENTITIES)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void putIdentities(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody ServiceRequestIdentitiesRequest body) {
        identities.replace(principal, id, body);
    }

    /**
     * {@code GET /service-requests/{id}/identities} (contract
     * {@code getServiceRequestIdentities}, {@code x-roles: [staff, admin]}) — the parties' PAN and
     * Aadhaar, for the operator drafting from them (D151).
     *
     * <p><strong>The role annotation is the outer guard, not the real one.</strong> It keeps
     * customers off a staff route; the service then refuses every staff member except the one the
     * request is assigned to, admins included. An admin who needs the numbers assigns the request to
     * themselves first — two visible moves if somebody else already holds it, since there is no
     * {@code assigned → assigned} transition — and each one is a timeline entry and an audit row. The
     * control is accountability, not prohibition, but it has to be crossed on purpose.
     *
     * <p>Every call here is written to {@code audit_log}, refusals as well as reads. Nothing else on
     * this controller is audited on the read path, because nothing else on it returns an Aadhaar
     * number.
     */
    @GetMapping(Routes.ServiceRequests.IDENTITIES)
    @PreAuthorize(SERVICES_READ)
    public List<ServiceRequestIdentityDto> getIdentities(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return identities.forAssignee(principal, id);
    }

    /**
     * {@code POST /service-requests/{id}/draft} (contract {@code shareServiceRequestDraft},
     * spec fix S41, {@code x-roles: [staff, admin]}) — the maker's half of the maker-checker.
     */
    @PostMapping(value = Routes.ServiceRequests.DRAFT,
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize(SERVICES_WRITE)
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
    @PreAuthorize(SERVICES_WRITE)
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentDto uploadFinalDoc(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestParam("file") MultipartFile file) {
        return service.uploadFinalDoc(principal, id, file);
    }

    /**
     * {@code POST /service-requests/{id}/cancel} — 200. The requester's own, and nobody else's.
     *
     * <p><strong>No {@code @PreAuthorize}, for the same reason as the draft decision above and the
     * mirror image of it.</strong> This one belongs to the customer, and the service refuses anyone
     * who is not the requester — including an admin, who already has {@code PATCH /status} for the
     * ops-side cancellation and does not need a second door into it.
     *
     * <p>A separate verb rather than opening {@code cancelled} to the customer through
     * {@code PATCH /status}: that endpoint is the ops workflow and its guard is a role. Handing the
     * customer a status field is handing them every status the field will ever accept, and the
     * maker-checker is exactly the thing that depends on them not having it.
     *
     * <p>404 if the request is not theirs (a stranger's is invisible, never forbidden), 403 if a
     * staff caller tries it, 409 if the request is not waiting for payment — the file's existing
     * convention for "the resource is not in a state where this makes sense", as on the draft
     * decision and the final document.
     */
    @PostMapping(CANCEL)
    public ServiceRequestDto cancel(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.cancelUnpaid(principal, id);
    }

    /**
     * {@code POST /service-requests/{id}/parties} (contract {@code inviteServiceRequestParty}) — 201.
     * The requester's own request, and nobody else's.
     *
     * <p><strong>No {@code @PreAuthorize}, and this one excludes ops rather than merely not
     * requiring them.</strong> Naming the counterparty on an agreement decides who may read it, so
     * it is the customer's act and not a support action. {@code CoFillParties} answers a stranger's
     * request with 404, matching every other customer-scoped route on this resource.
     */
    @PostMapping(Routes.ServiceRequests.PARTIES)
    @ResponseStatus(HttpStatus.CREATED)
    public ServiceRequestPartyDto inviteParty(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody PartyInvite body) {
        return parties.invite(principal, id, body.role(), body.mobile());
    }

    /**
     * {@code POST /service-requests/{id}/read} (contract {@code markServiceRequestRead}) — 204.
     * Anyone who can read the request.
     *
     * <p>204 rather than the updated thread: the client already holds the messages, and returning
     * them would make an idempotent bookkeeping call look like a read of the conversation.
     */
    @PostMapping(Routes.ServiceRequests.READ)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        receipts.markRead(principal, id);
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

    /**
     * Body of {@code inviteServiceRequestParty} (schema {@code ServiceRequestPartyInvite}).
     *
     * <p>{@link IndianMobile} so a typo that is not even a phone number is a 400 here rather than a
     * "no account" 409 further in — the two are different problems and the caller can only fix one
     * of them.
     */
    public record PartyInvite(@NotBlank String role, @NotBlank @IndianMobile String mobile) {
    }
}
