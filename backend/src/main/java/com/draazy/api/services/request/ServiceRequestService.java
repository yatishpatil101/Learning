package com.draazy.api.services.request;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.payments.AbandonedCheckouts;
import com.draazy.api.common.persistence.ConstraintViolations;
import com.draazy.api.common.web.Ids;
import com.draazy.api.documents.vault.DocumentDto;
import com.draazy.api.documents.vault.DocumentService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.PaymentGateway;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

// The maker-checker is the security of this class.
// The requester is the checker, so only their approval can move a draft to approved.
@Service
public class ServiceRequestService implements AbandonedCheckouts {

    private static final Logger log = LoggerFactory.getLogger(ServiceRequestService.class);

    // Details cap bounds worst-case rent-agreement jsonb near 48 KB.
    // String.length is enough: Devanagari is BMP; disk bytes may triple.
    private static final int DETAILS_MAX_CHARS = 16000;

    // One unpaid priced request is legitimate; more means live gateway order spam.
    private static final int MAX_OPEN_UNPAID_PER_TYPE = 1;

    // Index name lets us translate only the unpaid-cap collision to its 409.
    private static final String OPEN_UNPAID_INDEX = "uq_service_requests_open_unpaid";

    // Not payment.failed: this means no money was attempted, not a declined card.
    private static final String ABANDONED_EVENT = "payment.abandoned";

    static final Duration INCOMPLETE_TTL = Duration.ofDays(30);

    private final ServiceRequestRepository requests;
    private final ServiceRequestEventRepository events;
    private final ServiceRequestMessageRepository messages;
    private final ServiceRequestMapper mapper;
    private final DocumentService documents;

    // TicketMirror owns the only reach this flow makes into the ops board.
    private final TicketMirror ticketMirror;

    // Held only so transitions can purge; this class never reads identity numbers.
    private final ServiceRequestIdentityService identities;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final ServiceRequestPricing pricing;
    private final PaymentGateway gateway;
    private final AuditService audit;
    private final ObjectMapper objectMapper;
    private final ServiceRequestSelfDealing selfDealing;
    private final ServiceRequestDraftApprovals draftApprovals;
    private final AccountPermissions accountPermissions;

    private final TransactionTemplate transactions;

    public ServiceRequestService(ServiceRequestRepository requests,
            ServiceRequestEventRepository events,
            ServiceRequestMessageRepository messages,
            ServiceRequestMapper mapper,
            DocumentService documents,
            TicketMirror ticketMirror,
            ServiceRequestIdentityService identities,
            UserRepository users,
            PropertyRepository properties,
            ServiceRequestPricing pricing,
            PaymentGateway gateway,
            AuditService audit,
            ObjectMapper objectMapper,
            ServiceRequestSelfDealing selfDealing,
            ServiceRequestDraftApprovals draftApprovals,
            AccountPermissions accountPermissions,
            PlatformTransactionManager transactionManager) {
        this.requests = requests;
        this.events = events;
        this.messages = messages;
        this.mapper = mapper;
        this.documents = documents;
        this.ticketMirror = ticketMirror;
        this.identities = identities;
        this.users = users;
        this.properties = properties;
        this.pricing = pricing;
        this.gateway = gateway;
        this.audit = audit;
        this.objectMapper = objectMapper;
        this.selfDealing = selfDealing;
        this.draftApprovals = draftApprovals;
        this.accountPermissions = accountPermissions;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    // Priced requests start unpaid because readiness needs a request id.
    // Checkout later refuses until identities and papers are complete.
    public ServiceRequestDto create(AuthPrincipal caller, ServiceRequestCreate body) {
        Opened opened = transactions.execute(tx -> open(caller, body));
        if (opened.settled() != null) {
            return opened.settled();
        }
        return transactions.execute(tx -> mapper.toDto(requests.findById(opened.requestId()).orElseThrow(() -> NotFoundException.of("Service request")), caller));
    }

    private Opened open(AuthPrincipal caller, ServiceRequestCreate body) {
        UUID propertyId = body.propertyId() == null || body.propertyId().isBlank()
                ? null
                : Ids.parseUuid(body.propertyId()).orElseThrow(() -> new BadRequestException("propertyId must be a valid id"));

        // Listing existence must be checked before FK failure.
        // Missing listing is 404; malformed id is 400.
        if (propertyId != null && !properties.existsById(propertyId)) {
            throw NotFoundException.of("Property");
        }

        String type = body.type().trim();

        // Unknown service types are refused so misspelled rent agreements cannot price as free.
        if (!ServiceRequestTypes.isKnown(type)) {
            throw new BadRequestException("Unknown service request type '" + type + "'; expected one of "
                    + ServiceRequestTypes.known());
        }
        Map<String, Object> details = pricing.withServerTerms(type, boundedDetails(type, body.details()));
        UUID ticketId = ticketMirror.resolve(caller, body.ticketId());
        Long price = pricing.priceFor(type, details);
        if (price != null) {

            // Each priced request can open a live gateway order at checkout.
            // Cap it here because there is no other throttle.
            long openUnpaid = requests.countByRequesterIdAndTypeAndStatus(
                    caller.userId(), type, ServiceRequestStatus.AWAITING_PAYMENT);
            if (openUnpaid >= MAX_OPEN_UNPAID_PER_TYPE) {
                throw openUnpaidConflict(type);
            }
        }
        ServiceRequest draft = new ServiceRequest(caller.userId(), type, propertyId, details, ticketId);
        if (price != null) {

            // Awaiting-payment is set before INSERT so the partial unique index catches races.
            draft.awaitPayment(price);
        }
        ServiceRequest request;
        try {

            request = requests.saveAndFlush(draft);
        } catch (DataIntegrityViolationException violation) {

            // Translate only the cap's 409; other integrity failures are defects.
            if (isOpenUnpaidCollision(violation)) {
                log.info("Concurrent create lost the open-unpaid race for {} on desk {}",
                        caller.userId(), type);
                throw openUnpaidConflict(type);
            }

            // The other rule with a unique index behind it : one ticket, one request.
            if (ConstraintViolations.isOn(violation, TicketMirror.INDEX)) {
                log.info("Service request for {} refused: ticket {} is already mirrored",
                        caller.userId(), ticketId);
                throw TicketMirror.alreadyMirrored();
            }
            throw violation;
        }
        record(request, "request.created", displayName(caller.userId()));
        if (price == null) {

            return Opened.settled(mapper.toDto(request, caller));
        }
        record(request, "payment.pending", null);
        return new Opened(null, request.getId(), price, checkoutCustomer(caller));
    }

    private PaymentGateway.Customer checkoutCustomer(AuthPrincipal caller) {
        String phone = users.findById(caller.userId()).map(User::getMobile).orElse(null);
        return new PaymentGateway.Customer(caller.userId().toString(), phone);
    }

    private static Map<String, Object> mergeDetails(Map<String, Object> current,
            Map<String, Object> incoming) {
        Map<String, Object> merged = new LinkedHashMap<>();
        if (current != null) {
            merged.putAll(current);
        }
        if (incoming == null) {
            return merged;
        }
        for (Map.Entry<String, Object> entry : incoming.entrySet()) {
            Object value = entry.getValue();
            if (!isEmptyValue(value)) {
                Object currentValue = merged.get(entry.getKey());
                if (currentValue instanceof Map<?, ?> currentMap && value instanceof Map<?, ?> incomingMap) {
                    merged.put(entry.getKey(), mergeDetails(stringObjectMap(currentMap),
                            stringObjectMap(incomingMap)));
                } else {
                    merged.put(entry.getKey(), value);
                }
            }
        }
        return merged;
    }

    private static Map<String, Object> stringObjectMap(Map<?, ?> source) {
        Map<String, Object> result = new LinkedHashMap<>();
        source.forEach((key, value) -> {
            if (key instanceof String text) {
                result.put(text, value);
            }
        });
        return result;
    }

    private static boolean isEmptyValue(Object value) {
        if (value == null) {
            return true;
        }
        if (value instanceof String text) {
            return text.isBlank();
        }
        if (value instanceof Map<?, ?> map) {
            return map.isEmpty();
        }
        return false;
    }

    private record Opened(ServiceRequestDto settled, UUID requestId, long price,
            PaymentGateway.Customer customer) {

        static Opened settled(ServiceRequestDto dto) {
            return new Opened(dto, null, 0, null);
        }
    }

    private ConflictException openUnpaidConflict(String type) {
        return new ConflictException("You already have an unpaid " + type + " request. Cancel it "
                + "from your requests and start again, or finish paying for it — an unpaid request "
                + "is cancelled automatically once its checkout has expired.");
    }

    // Match driver's index name so unrelated constraint failures are not hidden as cap errors.
    private static boolean isOpenUnpaidCollision(DataIntegrityViolationException violation) {
        return ConstraintViolations.isOn(violation, OPEN_UNPAID_INDEX);
    }

    // Blank gateway order ids are refusals; otherwise webhooks cannot find the row.
    private PaymentGateway.PaymentOrder openOrder(Opened opened) {
        PaymentGateway.PaymentOrder order = gateway.createOrder(opened.price(),
                "service-request:" + opened.requestId(), opened.customer());
        if (order.orderId() == null || order.orderId().isBlank()) {
            throw new IllegalStateException("Payment gateway returned no order id");
        }
        return order;
    }

    // Webhook handling is idempotent by status; unknown order ids belong to other payers.
    @Transactional
    public boolean applyWebhookOutcome(String orderId, boolean paid, long providerAmount) {
        if (orderId == null || orderId.isBlank()) {
            return false;
        }
        ServiceRequest request = requests.findByPaymentRef(orderId).orElse(null);
        if (request == null) {
            return false;
        }

        // Check amount before idempotence; conflicting redeliveries are worth logging.
        Long billed = request.getAmount();
        if (paid && providerAmount > 0 && billed != null && providerAmount != billed) {
            log.error("Amount mismatch on service request {}: billed {} but provider charged {}",
                    request.getId(), billed, providerAmount);
        }
        if (request.getStatus() != ServiceRequestStatus.AWAITING_PAYMENT) {
            reportRefusedSettlement(request, paid);
            return true;
        }

        if (paid) {
            transition(request, ServiceRequestStatus.NEW);
            record(request, "payment.received", null);
        } else {
            transition(request, ServiceRequestStatus.CANCELLED);
            record(request, "payment.failed", null);
        }
        return true;
    }

    @Transactional
    public ServiceRequestDto simulateMockPayment(AuthPrincipal caller, String id, boolean paid) {
        ServiceRequest request = Ids.parseUuid(id).flatMap(requests::findByIdForUpdate)
                .orElseThrow(() -> NotFoundException.of("Service request"));
        if (!caller.userId().equals(request.getRequesterId())) {
            throw new ForbiddenException("Only the person who raised this request can settle it.");
        }
        String paymentRef = request.getPaymentRef();
        if (request.getStatus() != ServiceRequestStatus.AWAITING_PAYMENT || paymentRef == null
                || !paymentRef.startsWith("mock_order_")) {
            throw new ConflictException("Only an awaiting-payment mock checkout can be simulated.");
        }
        applyWebhookOutcome(paymentRef, paid, request.getAmount() == null ? 0 : request.getAmount());
        return mapper.toDto(request, caller);
    }

    private void reportRefusedSettlement(ServiceRequest request, boolean paid) {
        if (!paid || request.getStatus() != ServiceRequestStatus.CANCELLED) {
            log.info("Ignored payment callback for service request {}: already {}",
                    request.getId(), request.getStatus());
            return;
        }
        log.error("Payment settled for service request {} but it is cancelled — the customer has "
                + "been charged and no work is queued. Gateway order {}, raised by {}. Refund or "
                + "reconcile.", request.getId(), request.getPaymentRef(), request.getRequesterId());
    }

    // Guard by status, not paymentRef; ref exists in the modal-closed scenario this fixes.
    @Transactional
    public ServiceRequestDto cancelUnpaid(AuthPrincipal caller, String id) {
        ServiceRequest request = visible(caller, id);
        if (!caller.userId().equals(request.getRequesterId())) {
            throw new ForbiddenException(
                    "Only the person who raised this request can cancel it.");
        }
        if (request.getStatus() != ServiceRequestStatus.AWAITING_PAYMENT) {
            throw new ConflictException(
                    "Only a request still waiting for payment can be cancelled here — this one is "
                            + request.getStatus() + ".");
        }
        transition(request, ServiceRequestStatus.CANCELLED);
        record(request, ABANDONED_EVENT, displayName(caller.userId()));
        audit.record(caller, "service-request.cancelled-unpaid", "service_request",
                request.getId().toString(), "from", ServiceRequestStatus.AWAITING_PAYMENT.wire());
        return mapper.toDto(request, caller);
    }

    // {@inheritDoc} — "service request", so a sweep log line names the table that moved.
    @Override
    public String family() {
        return "service request";
    }

    @Override
    @Transactional
    public int expireAbandonedCheckouts(Instant cutoff) {
        List<ServiceRequest> stale = requests.findStaleByStatus(ServiceRequestStatus.AWAITING_PAYMENT,
                cutoff, cutoff.minus(INCOMPLETE_TTL), Limit.of(MAX_PER_SWEEP));
        int expired = 0;
        for (ServiceRequest request : stale) {
            if (request.getStatus() != ServiceRequestStatus.AWAITING_PAYMENT) {
                continue;
            }
            transition(request, ServiceRequestStatus.CANCELLED);
            record(request, ABANDONED_EVENT, null);
            expired++;
            log.info("Service request {} cancelled: awaiting payment since {} with nothing paid",
                    request.getId(), request.getUpdatedAt());
        }
        return expired;
    }

    private Map<String, Object> boundedDetails(String type, Map<String, Object> details) {
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
        ServiceRequestDetailsGuard.check(type, details);
        return details;
    }

    // get() and checklist share visible(); documents come from same DTO list.
    // A second vault query could drift from the documents tab.
    @Transactional(readOnly = true)
    public ServiceRequestDto get(AuthPrincipal caller, String id) {
        return mapper.toDto(visible(caller, id), caller);
    }

    // The requester or ops.
    // authorRole is taken from the principal, so a customer cannot post as staff.
    @Transactional
    public MessageDto addMessage(AuthPrincipal caller, String id, String body) {
        ServiceRequest request = visible(caller, id);
        if (request.getStatus().isTerminal()) {
            throw new ConflictException(
                    "This request is " + request.getStatus() + " — start a new one to continue.");
        }
        return mapper.toMessageDto(messages.saveAndFlush(new ServiceRequestMessage(
                request.getId(), caller.userId(), caller.role(), body)));
    }

    @Transactional
    public DocumentDto addDocument(AuthPrincipal caller, String id, String category,
            MultipartFile file) {
        ServiceRequest request = visible(caller, id);
        return storeDocument(caller, request, filedCategory(caller, request, category), file,
                "document.uploaded");
    }

    // Ops cannot file customer vault docs; draft authors must not approve their own draft.
    @Transactional
    public DocumentDto addDocumentFromVault(AuthPrincipal caller, String id, String documentId,
            String category) {
        if (isOps(caller)) {
            throw new ForbiddenException("Only a party can file papers from their own vault.");
        }
        ServiceRequest request = visible(caller, id);
        DocumentDto dto = documents.fileFromPersonalVault(caller.userId(), documentId,
                request.getPropertyId(), request.getId(), filedCategory(caller, request, category));
        record(request, "document.uploaded", displayName(caller.userId()));
        return dto;
    }

    private String filedCategory(AuthPrincipal caller, ServiceRequest request, String category) {
        String filedAs = ServiceRequestDrafting.customerCategory(request, category);
        String side = RentAgreementReadiness.sideOf(filedAs);
        if (side != null && !isOps(caller)) {
            int partyIndex = partyIndexOf(filedAs, side);
            boolean ownSlot = identities.hasAcceptedSlot(request.getId(), caller.userId(),
                    side, partyIndex);
            if (!ownSlot
                    && (!caller.userId().equals(request.getRequesterId())
                            || identities.hasLiveCoFillSlot(request.getId(), side, partyIndex))) {
                throw new ForbiddenException("You can file papers only for your own side of this agreement.");
            }
        }
        return filedAs;
    }

    private static int partyIndexOf(String category, String side) {
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile(("tenant".equals(side) ? "^tenant-" : "^licensor-") + "(\\d+)-").matcher(category);
        return matcher.find() ? Integer.parseInt(matcher.group(1)) : 0;
    }

    @Transactional
    public ServiceRequestDto decideDraft(AuthPrincipal caller, String id, String decision,
            String note) {
        ServiceRequest request = found(id);
        if (!caller.userId().equals(request.getRequesterId())
                && !draftApprovals.canReject(caller, request)) {
            throw new ForbiddenException(
                    "Only an executing party can approve or reject the draft.");
        }
        boolean approve = switch (decision == null ? "" : decision.trim().toLowerCase()) {
            case "approve" -> true;
            case "reject" -> false;
            default -> throw new BadRequestException("decision must be 'approve' or 'reject'");
        };
        ServiceRequestStatus target = approve
                ? ServiceRequestStatus.APPROVED
                : ServiceRequestStatus.CHANGES_REQUESTED;
        if (request.getStatus() != ServiceRequestStatus.DRAFT_SHARED) {
            throw new ConflictException(
                    "There is no draft awaiting your decision — this request is "
                            + request.getStatus() + ".");
        }
        String reason = blankToNull(note);
        if (!approve && reason == null) {
            throw new BadRequestException(
                    "Say what should change in the draft — our team revises it from your reason.");
        }
        if (approve) {
            if (ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
                if (!draftApprovals.approveInApp(caller, request)) {
                    record(request, "draft.approval", displayName(caller.userId()));
                    audit.record(caller, "service-request.draft-decision", "service_request",
                            request.getId().toString(), "from", request.getStatus().wire(), "to",
                            request.getStatus().wire(), "note", note);
                    return mapper.toDto(request, caller);
                }
            } else if (!ServiceRequestReadReceipts.draftOpened(
                    events.findByRequestIdOrderByAtAsc(request.getId()))) {
                throw new ConflictException("Open the draft and read it before you approve it.");
            }
        }
        ServiceRequestStatus from = transition(request, target);
        record(request, approve ? "draft.approved" : "draft.rejected", displayName(caller.userId()));
        if (!approve) {
            messages.save(new ServiceRequestMessage(
                    request.getId(), caller.userId(), caller.role(), reason));
        }
        audit.record(caller, "service-request.draft-decision", "service_request",
                request.getId().toString(), "from", from.wire(), "to", target.wire(), "note", note);
        return mapper.toDto(request, caller);
    }

    @Transactional
    void completeDraftApproval(AuthPrincipal caller, String id) {
        ServiceRequest request = found(id);
        if (request.getStatus() != ServiceRequestStatus.DRAFT_SHARED) {
            return;
        }
        ServiceRequestStatus from = transition(request, ServiceRequestStatus.APPROVED);
        record(request, "draft.approved", displayName(caller.userId()));
        audit.record(caller, "service-request.draft-decision", "service_request",
                request.getId().toString(), "from", from.wire(), "to", ServiceRequestStatus.APPROVED.wire(),
                "note", null);
    }

    DocumentDto storeDocument(AuthPrincipal caller, ServiceRequest request, String category,
            MultipartFile file, String event) {
        if (file == null || file.isEmpty()) {
            throw new BadRequestException("Attach a file to upload.");
        }
        DocumentDto dto = documents.uploadForServiceRequest(
                request.getPropertyId(), request.getId(), category, file);
        if (event != null) {
            record(request, event, displayName(caller.userId()));
        }
        return dto;
    }

    // Purge is visible on the customer timeline: it completes the retention promise.
    ServiceRequestStatus transition(ServiceRequest request, ServiceRequestStatus target) {
        ServiceRequestStatus from = request.getStatus();
        if (!from.canTransitionTo(target)) {
            throw new ConflictException(
                    "Cannot move a service request from %s to %s.".formatted(from, target));
        }
        request.moveTo(target);
        if (target.isTerminal() && identities.purgeFor(request.getId()) > 0) {
            record(request, ServiceRequestIdentityService.PURGED, null);
        }
        return from;
    }

    void record(ServiceRequest request, String event, String by) {
        events.save(new ServiceRequestEvent(request.getId(), event, by));
    }

    void requireHolder(AuthPrincipal caller, ServiceRequest request, String act, String theirs) {
        UUID holder = request.getAssigneeId();
        if (Roles.Wire.ADMIN.equals(caller.role()) || Roles.Wire.MANAGER.equals(caller.role())
                || caller.userId().equals(holder)) {
            return;
        }
        throw new ConflictException(holder == null
                ? "Take this request before " + act + "."
                : Objects.requireNonNullElse(displayName(holder), "A colleague")
                        + " holds this request, so " + theirs + ".");
    }

    // Any existing request.
    // Used by the ops-only operations, whose role guard is the controller's.
    private ServiceRequest found(String id) {
        return Ids.parseUuid(id).flatMap(requests::findById).orElseThrow(() -> NotFoundException.of("Service request"));
    }

    // Package-private so read receipts reuse the same participant guard.
    ServiceRequest visible(AuthPrincipal caller, String id) {
        ServiceRequest request = found(id);
        if (requests.isParticipant(request.getId(), caller.userId())) {
            return request;
        }
        if (!isOps(caller)) {
            throw NotFoundException.of("Service request");
        }
        return ServiceDeskAuthority.onCallersDesk(caller, request,
                accountPermissions.desksFor(caller));
    }

    // Any existing request on the calling operator's own desk that they are not a side of.
    // For the ops-only operations.
    ServiceRequest opsAccessible(AuthPrincipal caller, String id) {
        ServiceRequest request = ServiceDeskAuthority.onCallersDesk(caller, found(id),
                accountPermissions.desksFor(caller));
        selfDealing.refuse(caller, request);
        return request;
    }

    private static boolean isOps(AuthPrincipal caller) {
        return Roles.isBackOffice(caller.role());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    String displayName(UUID userId) {
        return users.findById(userId).map(User::getName).orElse(null);
    }

    // Co-fill files without checkout so both sides can complete a priced agreement first.
    // Free requests have no payment to defer.
    UUID fileDeferred(AuthPrincipal caller, ServiceRequestCreate body) {
        Opened opened = open(caller, body);
        if (opened.settled() != null) {
            throw new BadRequestException("Co-fill is only supported for priced service requests.");
        }
        return opened.requestId();
    }

    // The same request, locked for update, with the same participant guard the reads use.
    ServiceRequest visibleForUpdate(AuthPrincipal caller, String id) {
        ServiceRequest request = Ids.parseUuid(id).flatMap(requests::findByIdForUpdate).orElseThrow(() -> NotFoundException.of("Service request"));
        if (!isOps(caller) && !requests.isParticipant(request.getId(), caller.userId())) {
            throw NotFoundException.of("Service request");
        }
        return request;
    }

    PaymentGateway.PaymentOrder openOrderFor(AuthPrincipal caller, ServiceRequest request) {
        return openOrder(new Opened(null, request.getId(), request.getAmount(),
                checkoutCustomer(caller)));
    }

    Map<String, Object> mergedBoundedDetails(ServiceRequest request, Map<String, Object> incoming) {
        return mergeDetails(request.getDetails(), boundedDetails(request.getType(), incoming));
    }

    void recordBy(ServiceRequest request, String event, UUID actor) {
        record(request, event, displayName(actor));
    }
}
