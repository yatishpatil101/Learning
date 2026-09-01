package com.punenest.api.services.request;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.payments.AbandonedCheckouts;
import com.punenest.api.common.persistence.ConstraintViolations;
import com.punenest.api.common.trust.Notifier;
import com.punenest.api.common.web.Ids;
import com.punenest.api.documents.vault.DocumentDto;
import com.punenest.api.documents.vault.DocumentService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.provider.PaymentGateway;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
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

/**
 * The assisted-service workflow: a customer asks, ops does the work, ops shares a draft, and the
 * customer accepts it before anything is registered.
 *
 * <p><strong>The maker-checker is the security of this class.</strong> Ops is the maker — it assigns,
 * works and shares the draft. The customer is the checker — {@link #decideDraft} is the <em>only</em>
 * way to reach {@code approved}, and only the requester may call it. Three things protect that:
 *
 * <ol>
 *   <li>{@link ServiceRequestStatus#isStaffSettable} keeps {@code approved}, {@code draft-shared}
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
public class ServiceRequestService implements AbandonedCheckouts {

    private static final Logger log = LoggerFactory.getLogger(ServiceRequestService.class);

    /**
     * Serialized-size ceiling for {@code details}, restoring the bound the old flat-string schema had
     * (D119: it was {@code @Size(4000)}). The field is now a free-form {@code jsonb} object reachable
     * by any authenticated caller and written verbatim, so an unbounded object is a storage-growth
     * vector; the cap is measured on the serialized JSON — the form actually persisted — mirroring
     * {@code SavedSearchService.serializeFilters}.
     *
     * <p><b>D157 — this number is measured, not guessed.</b> It was 8000, chosen for a payload nobody
     * had sized. The rent-agreement wizard embeds its whole form state in {@code details._state}, and
     * reconstructing that state from the form's real fields put the worst *realistic* case — four
     * tenants, a 2000-character clauses field, 300-character addresses, a full furniture list — at
     * <b>7875 characters</b>. That is 125 characters of headroom: the customer would have met a 400 at
     * the end of a six-step form, which is exactly the failure the cap was not supposed to cause. Each
     * additional tenant costs ~645 characters and each clauses character costs one.
     *
     * <p>16000 is twice that worst realistic case and above the pathological one (six tenants, a
     * 5000-character clauses field, ~13065 characters), which bounds a row at ~48 KB of jsonb.
     * Script is irrelevant here: Devanagari is BMP, so one UTF-16 unit per character against
     * {@code String.length()} — only the on-disk byte count triples.
     *
     * <p><b>The wizard mirrors this number</b> in {@code helpers.js} so the form refuses before the
     * submit does. Change both together: a client that believes in a larger cap than this one
     * enforces is worse than no guard, because it promises a submit that will fail.
     */
    private static final int DETAILS_MAX_CHARS = 16000;

    /**
     * How many unpaid priced requests one caller may hold open per desk.
     *
     * <p>One, because each opens a live gateway order and the legitimate need is exactly one: you
     * are either paying for this agreement or you are not. This is a cap on outstanding orders, not
     * a rate limit — the endpoint still has no throttle (D2).
     *
     * <p><strong>The value is mirrored by {@code uq_service_requests_open_unpaid}</strong> (V43,
     * D153), which is what actually holds the cap under concurrency. A unique index can only express
     * "at most one", so raising this constant means replacing that index too — otherwise this would
     * wave a second order through and the database would refuse it with a message about the first.
     */
    private static final int MAX_OPEN_UNPAID_PER_TYPE = 1;

    /**
     * The V43 partial unique index that enforces {@link #MAX_OPEN_UNPAID_PER_TYPE} (D153).
     *
     * <p>Named here so its violation can be told apart from a not-null or foreign-key one and
     * answered as the cap's own 409 rather than the generic "conflicts with existing data".
     */
    private static final String OPEN_UNPAID_INDEX = "uq_service_requests_open_unpaid";

    /**
     * The timeline event for a checkout that was opened and then walked away from (D152).
     *
     * <p>Deliberately not {@code payment.failed}. That means the gateway refused the money, which is
     * something the customer may want to retry with another card; this means no money was ever
     * attempted. Reading the two as one event would make "my payment was declined" and "I closed the
     * tab" indistinguishable in support, and they call for opposite advice.
     */
    private static final String ABANDONED_EVENT = "payment.abandoned";

    private final ServiceRequestRepository requests;
    private final ServiceRequestEventRepository events;
    private final ServiceRequestMessageRepository messages;
    private final ServiceRequestMapper mapper;
    private final DocumentService documents;
    /**
     * The ticket link (D45), which owns the only reach this flow makes into the ops board.
     *
     * <p>The arrow points this way and only this way. {@code services.ticket} knows nothing about
     * {@code services.request}, so the board keeps working if this workflow is never used, and the
     * two sub-packages cannot form a cycle.
     */
    private final TicketMirror ticketMirror;
    /**
     * The identity-number channel (D151) — held only so {@link #transition} can discard the numbers
     * when a matter closes. Nothing here ever reads them: this class's own DTO is what the ops queue
     * projects, and a getter on it is exactly the leak that channel exists to replace.
     */
    private final ServiceRequestIdentityService identities;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final ServiceRequestPricing pricing;
    private final PaymentGateway gateway;
    private final AuditService audit;
    private final ObjectMapper objectMapper;
    /**
     * How the customer is told a draft is waiting on them (D121 follow-on).
     *
     * <p>The maker-checker only works if the checker knows they have been handed something. Until
     * this existed, {@link #shareDraft} moved the request into {@code draft-shared} and told nobody:
     * the customer learned about it by happening to revisit the service page. That is the same
     * defect class as an unannounced co-fill invitation, and the same fix — the platform already has
     * twelve other senders behind {@link Notifier}, so service requests were the outlier.
     */
    private final Notifier notifier;

    /** Runs the two short transactions {@link #create} is built from — see the field it mirrors on
     * {@code SubscriptionService} for why the template is built here and why propagation is left at
     * {@code REQUIRED}. */
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
            Notifier notifier,
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
        this.notifier = notifier;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /**
     * Contract {@code createServiceRequest} — 201. Any authenticated caller, for themselves.
     *
     * <p><strong>Deliberately not {@code @Transactional}</strong> (D148). A priced request is
     * committed in {@code awaiting-payment} <em>before</em> the Cashfree order is opened, and the
     * order id is attached in a second transaction. Opening the order inside the transaction that
     * persists the request means any later failure — the flush, the timeline write, a constraint —
     * destroys the request while leaving a payable order behind it, so a customer could pay for an
     * agreement that no longer exists and the callback would match nothing.
     */
    public ServiceRequestDto create(AuthPrincipal caller, ServiceRequestCreate body) {
        Opened opened = transactions.execute(tx -> open(caller, body));

        if (opened.settled() != null) {
            // A free desk: it is already in the queue and there is no money to collect.
            return opened.settled();
        }

        PaymentGateway.PaymentOrder order;
        try {
            order = openOrder(opened);
            return transactions.execute(tx -> attach(opened.requestId(), order));
        } catch (RuntimeException checkoutFailed) {
            // The attach is inside the guard, not only the gateway call. A second-transaction
            // failure would otherwise leave an awaiting-payment request occupying this requester's
            // one-open-unpaid slot for that desk, and they could not raise another.
            abandon(opened);
            throw checkoutFailed;
        }
    }

    /**
     * First transaction: validate, file the request, and commit it in the state that matches whether
     * it needs paying for.
     */
    private Opened open(AuthPrincipal caller, ServiceRequestCreate body) {
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
        String type = body.type().trim();
        // The type decides the price, so it has to be a closed set: `Rent-Agreement`, `rent_agreement`
        // and the frontend's own `rental` all used to miss the exact-match pricer and file a *free*
        // rent agreement that ops would then work for nothing. Rejecting the unknown spelling is what
        // makes that mistake loud instead of free. See ServiceRequestTypes.
        if (!ServiceRequestTypes.isKnown(type)) {
            throw new BadRequestException("Unknown service request type '" + type + "'; expected one of "
                    + ServiceRequestTypes.known());
        }
        UUID ticketId = ticketMirror.resolve(caller, body.ticketId());
        Long price = pricing.priceFor(type, details);
        if (price != null) {
            // Each priced request opens a live gateway order. Nothing else throttles this endpoint,
            // so without a ceiling a loop over POST /service-requests opens unbounded real orders
            // against our merchant account at no cost to the caller. One open unpaid request per
            // desk is the whole legitimate need — you are either paying for this agreement or you
            // are not — and the existing one is visible in the caller's own list as
            // `awaiting-payment`, so this points at something they can act on rather than a wall.
            //
            // This count is the fast path, not the guarantee (D153): it is an unlocked read over
            // rows that do not exist yet, so N concurrent creates all see zero. It stays because it
            // produces the better message on the ordinary double click; the unique index caught
            // below is what holds under concurrency.
            long openUnpaid = requests.countByRequesterIdAndTypeAndStatus(
                    caller.userId(), type, ServiceRequestStatus.AWAITING_PAYMENT);
            if (openUnpaid >= MAX_OPEN_UNPAID_PER_TYPE) {
                throw openUnpaidConflict(type);
            }
        }
        ServiceRequest draft = new ServiceRequest(caller.userId(), type, propertyId, details, ticketId);
        if (price != null) {
            // A priced desk (rent agreement) is held behind a Cashfree order: ops sees nothing until
            // the payment webhook settles it (findForQueue excludes awaiting-payment). The hold is
            // committed here, before the order exists; the order id lands in attach() a moment later.
            //
            // Set before the INSERT rather than after it, so the row enters the world in the state it
            // belongs in — which is also what puts it inside uq_service_requests_open_unpaid on the
            // INSERT itself, so a losing racer is refused by the flush below rather than at commit,
            // where no handler could translate it.
            draft.awaitPayment(price);
        }
        ServiceRequest request;
        try {
            // saveAndFlush: @UuidGenerator/@CreationTimestamp populate at INSERT, the timeline entry
            // below needs the id, and the flush is what brings a unique-index refusal inside this
            // try instead of letting Hibernate defer it to commit.
            request = requests.saveAndFlush(draft);
        } catch (DataIntegrityViolationException violation) {
            // Answer the cap's own 409, with the cap's own message, so the API contract does not
            // depend on which of the two guards refused the caller. Anything else — a foreign key,
            // a not-null — is a real defect and must not be dressed up as a business rule.
            if (isOpenUnpaidCollision(violation)) {
                log.info("Concurrent create lost the open-unpaid race for {} on desk {}",
                        caller.userId(), type);
                throw openUnpaidConflict(type);
            }
            // The other rule with a unique index behind it (D45): one ticket, one request.
            if (ConstraintViolations.isOn(violation, TicketMirror.INDEX)) {
                log.info("Service request for {} refused: ticket {} is already mirrored",
                        caller.userId(), ticketId);
                throw TicketMirror.alreadyMirrored();
            }
            throw violation;
        }
        record(request, "request.created", displayName(caller.userId()));
        if (price == null) {
            // A free desk enters the queue straight away.
            return Opened.settled(mapper.toDto(request));
        }
        record(request, "payment.pending", null);
        return new Opened(null, request.getId(), price, checkoutCustomer(caller));
    }

    /**
     * Customer identity passed to the payment gateway for a checkout-bound request.
     */
    private PaymentGateway.Customer checkoutCustomer(AuthPrincipal caller) {
        String phone = users.findById(caller.userId()).map(User::getMobile).orElse(null);
        return new PaymentGateway.Customer(caller.userId().toString(), phone);
    }

    /**
     * Merge partial details into the current payload with the same non-empty semantics as the
     * original browser co-fill flow: empty values never erase an existing one.
     */
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
            if (!isEmptyValue(entry.getValue())) {
                merged.put(entry.getKey(), entry.getValue());
            }
        }
        return merged;
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

    /**
     * Second transaction: record the order the committed request is waiting on.
     *
     * <p>The session id rides back on this one response for the checkout SDK and is never stored.
     */
    private ServiceRequestDto attach(UUID requestId, PaymentGateway.PaymentOrder order) {
        ServiceRequest request = requests.findById(requestId)
                .orElseThrow(() -> new IllegalStateException("Service request " + requestId
                        + " disappeared before gateway order " + order.orderId()
                        + " could be attached"));
        if (!request.attachOrder(order.orderId())) {
            log.error("Service request {} would not take gateway order {}; it is {} with ref {}",
                    requestId, order.orderId(), request.getStatus(), request.getPaymentRef());
        }
        return mapper.toDto(requests.saveAndFlush(request))
                .withPaymentSessionId(order.paymentSessionId());
    }

    /**
     * Compensating write for a gateway that refused the order after the request was committed
     * (D148).
     *
     * <p>Cancelled, not deleted and not left waiting. Deleting is not available — the timeline rows
     * written above reference it — and leaving it in {@code awaiting-payment} would be the worst of
     * the three: the caller can never reach a checkout for it, ops never sees it, and it consumes
     * the one-open-unpaid slot above, so the customer's retry would be refused with "you already
     * have an unpaid request" pointing at a request they cannot pay. Cancelling frees that slot and
     * gives the same timeline the webhook's own failure path writes.
     *
     * <p>A failure to compensate is logged and swallowed so the caller still gets the gateway's
     * error rather than a bookkeeping one.
     *
     * <p>The null-reference guard mirrors {@code abandonUnopened} on the other three payment
     * entities. A request that has a reference is one the gateway did accept, which means a webhook
     * could already have settled it — and the transition table permits {@code NEW → CANCELLED}, so
     * without this check a late compensation could cancel a request the customer has paid for.
     * Unreachable today, because this path only runs while the reference is still null; guarded in
     * code rather than by circumstance so it stays true when someone writes the reference earlier.
     */
    private void abandon(Opened opened) {
        try {
            transactions.executeWithoutResult(tx -> requests.findById(opened.requestId())
                    .filter(request -> request.getPaymentRef() == null)
                    .ifPresent(request -> {
                        transition(request, ServiceRequestStatus.CANCELLED);
                        record(request, "payment.failed", null);
                    }));
            log.error("No gateway order for service request {}; cancelled it. Nothing was charged "
                    + "and the requester may file another.", opened.requestId());
        } catch (RuntimeException compensationFailed) {
            log.error("Could not cancel service request {} after its gateway order failed; it will "
                    + "sit in awaiting-payment and block the requester's next attempt",
                    opened.requestId(), compensationFailed);
        }
    }

    /**
     * What survives the first transaction: a finished response, or plain values describing the order
     * to open. No entity crosses a transaction boundary.
     */
    private record Opened(ServiceRequestDto settled, UUID requestId, long price,
            PaymentGateway.Customer customer) {

        static Opened settled(ServiceRequestDto dto) {
            return new Opened(dto, null, 0, null);
        }
    }

    /**
     * The one 409 the unpaid-order cap returns, whichever guard produced it (D153).
     *
     * <p><strong>The wording is the fix for D152's other half.</strong> It used to say "pay for it or
     * cancel it", and the customer could do neither: no webhook is generated by closing the Cashfree
     * modal, so there was no way back to that checkout, and {@code PATCH /status} is staff-only. The
     * message named two actions that did not exist and the wizard then hid the form. Both actions are
     * real now — {@code POST /{id}/cancel} is the customer's, and the sweep does it for them if they
     * never come back — so the message may finally be taken at face value.
     */
    private ConflictException openUnpaidConflict(String type) {
        return new ConflictException("You already have an unpaid " + type + " request. Cancel it "
                + "from your requests and start again, or finish paying for it — an unpaid request "
                + "is cancelled automatically once its checkout has expired.");
    }

    /**
     * Whether this constraint violation is the open-unpaid cap rather than a genuine bug.
     *
     * <p>Matched on the index name in the driver's own message, because {@code create} is also where
     * a bad {@code property_id} or a missing column would surface, and translating those into "you
     * already have an unpaid request" would hide a defect behind a business rule that reads as if the
     * system were working. The match itself lives in {@link ConstraintViolations} — four services
     * need the identical two lines against four different index names (D170).
     */
    private static boolean isOpenUnpaidCollision(DataIntegrityViolationException violation) {
        return ConstraintViolations.isOn(violation, OPEN_UNPAID_INDEX);
    }

    /**
     * Open the Cashfree order that gates a priced request. Called with no transaction open (D148).
     *
     * <p>The order id is the durable handle the payment webhook matches on ({@code payment_ref}); a
     * blank one would strand a request in {@code awaiting-payment} forever, so it is treated as a
     * refusal and routed into {@link #abandon} with everything else. The reference carries the
     * request id so a settlement is traceable to a row.
     */
    private PaymentGateway.PaymentOrder openOrder(Opened opened) {
        PaymentGateway.PaymentOrder order = gateway.createOrder(opened.price(),
                "service-request:" + opened.requestId(), opened.customer());
        if (order.orderId() == null || order.orderId().isBlank()) {
            throw new IllegalStateException("Payment gateway returned no order id");
        }
        return order;
    }

    /**
     * Settle a priced request from the payment webhook: a paid order lets it into the queue, a failed
     * one cancels it.
     *
     * <p>Matched by order id, and idempotent by state — a redelivered callback finds the request no
     * longer {@code awaiting-payment} and does nothing. An order id that matches no request (a
     * subscription's, a boost's) is ignored, exactly as the other settle hooks do, because the
     * webhook fans one event out to every payer; the return value is how the fan-out tells that
     * apart from a paid order <em>no</em> payer owns, which is money taken against nothing.
     *
     * @param providerAmount what the provider says was charged, whole rupees, or {@code 0} if it
     *                       sent none — checked against our own figure, never written over it
     * @return whether this table owned the order
     */
    @Transactional
    public boolean applyWebhookOutcome(String orderId, boolean paid, long providerAmount) {
        if (orderId == null || orderId.isBlank()) {
            return false;
        }
        ServiceRequest request = requests.findByPaymentRef(orderId).orElse(null);
        if (request == null) {
            return false;
        }
        // Reconciliation, not enforcement, and deliberately checked before the idempotence guard
        // below: a redelivery that reports a *different* amount than the
        // first one is the case most worth shouting about, and it is the one that returns early.
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

    /**
     * Say what it means that a callback could not be applied — and say it at the right volume.
     *
     * <p><strong>Why this stopped being one log line (D161).</strong> Most refusals here are a
     * redelivered callback on a request that is already working its way through the queue, which is
     * routine. One is not: a <em>paid</em> callback on a {@code cancelled} request means the money
     * arrived after the request was closed — because D152's sweep retired the checkout, or because a
     * declined payment later went through — and nobody is doing the work it bought. The fan-out's
     * own "unreconciled" alarm cannot see it, because this method returns {@code true}: the order is
     * ours, we simply could not honour it. D161 made the same distinction in the other three payment
     * families and it belongs here for the same reason.
     */
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

    /**
     * Contract-adjacent {@code POST /service-requests/{id}/cancel} — <strong>the requester, and
     * nobody else</strong>. The customer's way out of a checkout they abandoned (D152).
     *
     * <p><strong>Why this exists at all.</strong> Closing the Cashfree modal generates no webhook, so
     * an {@code awaiting-payment} row has, until now, had no exit: ops cannot see it
     * ({@code findForQueue} excludes the status), {@code PATCH /status} is staff-only, and the
     * one-open-unpaid cap then refused the customer's next attempt while pointing at a request they
     * could not act on. A customer could lock themselves out of a paid desk by changing their mind.
     *
     * <p><strong>Why not widen {@code STAFF_SETTABLE} instead.</strong> That set is about what a
     * <em>staff</em> caller may set through the status endpoint; the problem here is a customer with
     * no endpoint at all. Adding a status the customer could set would have meant giving them the
     * status endpoint, and the maker-checker depends on them not having it.
     *
     * <p><strong>Why the guard is the status and not the payment reference.</strong> The reference is
     * present in exactly the case this endpoint exists for — the order was opened, the modal was
     * closed — so refusing on it would make the endpoint a no-op for its own scenario. What proves no
     * money arrived is the status: a settled payment moves the request to {@code new} and a refused
     * one to {@code cancelled}, so a row still at {@code awaiting-payment} has never been paid. The
     * narrow residual race — the customer paying and cancelling at the same moment — is closed by
     * {@code @Version} on the row: one of the two writers loses with a 409.
     *
     * @throws ForbiddenException if the caller is not the requester (ops has {@code PATCH /status})
     * @throws ConflictException  if the request is not waiting for payment
     */
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
        return mapper.toDto(request);
    }

    /** {@inheritDoc} — "service request", so a sweep log line names the table that moved. */
    @Override
    public String family() {
        return "service request";
    }

    /**
     * Cancel every checkout that was opened and then walked away from (D152). Driven by
     * {@code AbandonedCheckoutSweep}, which sweeps this family alongside subscriptions, boosts and
     * rent payments (D161) — it replaced this class's own scheduler, which was the same trigger with
     * one implementation hard-coded into it.
     *
     * <p><strong>Why a sweep as well as {@link #cancelUnpaid}.</strong> Self-cancel needs the
     * customer to come back and press something; most people who abandon a checkout simply never
     * return. Without the timer their row would hold the one-open-unpaid slot for that desk forever,
     * so the desk would still be closed to them — and the ops queue would accumulate rows nobody can
     * see, work or clear. The sweep is what makes the cap self-healing rather than a latch.
     *
     * <p><strong>Nothing paid is ever touched.</strong> The status filter is the proof: a settled
     * payment moves the request to {@code new} and a refused one to {@code cancelled}, so a row still
     * at {@code awaiting-payment} is one no money has arrived for. The status is re-checked per row
     * on the way past — the same shape as the {@code paymentRef == null} guard in {@link #abandon},
     * guarded in code rather than by circumstance so it stays true if someone widens the query. The
     * race against a webhook settling mid-sweep is closed by {@code @Version}: one writer loses.
     *
     * <p>Runs in one transaction, like {@code SubscriptionService.expireLapsed}: the set is small
     * (only rows past the TTL) and a partial commit would leave a state no reader could interpret.
     *
     * @param cutoff requests created before this instant have run out of checkout time; passed in so
     *               tests need not wait on a clock
     * @return how many requests this call actually cancelled
     */
    @Override
    @Transactional
    public int expireAbandonedCheckouts(Instant cutoff) {
        List<ServiceRequest> stale = requests.findStaleByStatus(
                ServiceRequestStatus.AWAITING_PAYMENT, cutoff, Limit.of(MAX_PER_SWEEP));
        int expired = 0;
        for (ServiceRequest request : stale) {
            if (request.getStatus() != ServiceRequestStatus.AWAITING_PAYMENT) {
                continue;
            }
            // Deferred co-fill rows intentionally sit awaiting-payment with no gateway order yet.
            // Only rows that actually opened checkout are auto-expired by this sweep.
            if (request.getPaymentRef() == null) {
                continue;
            }
            transition(request, ServiceRequestStatus.CANCELLED);
            record(request, ABANDONED_EVENT, null);
            expired++;
            log.info("Service request {} cancelled: its checkout was opened at {} and never paid",
                    request.getId(), request.getCreatedAt());
        }
        return expired;
    }

    /**
     * Reject a {@code details} object that is too large, or that carries a statutory identity number.
     *
     * <p><strong>Size.</strong> The old flat-string schema capped this at 4000 chars ({@code @Size});
     * {@code @Size} cannot bound a {@code Map}, so the ceiling is re-established here on the
     * serialized JSON — the form actually stored — exactly as {@code SavedSearchService.serializeFilters}
     * does. A null or empty object passes through untouched — "no structured detail" is a valid request.
     *
     * <p><strong>Identity numbers.</strong> {@code details} is stored as plaintext {@code jsonb} and
     * echoed verbatim by {@link ServiceRequestMapper} on every read, including the paged ops queue.
     * The rent-agreement wizard used to post the whole form state here, so a PAN and an Aadhaar for
     * the owner and every tenant went into it — which made any {@code staff} account's first page of
     * the queue a bulk identity dump, and Aadhaar is not ours to spread (Aadhaar Act s.29). The
     * wizard now redacts them client-side; this refuses them, so a future call site that forgets
     * fails loudly instead of leaking quietly. Nothing legitimate needs to send one: identity
     * <em>documents</em> belong in the vault, identity <em>numbers</em> go to
     * {@code PUT /service-requests/{id}/identities} (D151), where exactly one operator can read them
     * and every read is recorded, and the other four desks send only free text.
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
        rejectIdentityNumbers(details);
        return details;
    }

    /**
     * Substrings that mark a key as carrying a statutory identity number, matched at any depth.
     *
     * <p>Matched on the key rather than the value: a PAN-shaped string could be a coincidence, but a
     * key called {@code aadhaar} is an intent. Matched on a normalised <em>substring</em> rather than
     * an exact name because this is the backstop for a client-side redaction that a future call site
     * may forget — {@code panNo}, {@code pan_number}, {@code aadhaarNumber} and {@code tenantPan} are
     * the same disclosure as {@code pan}, and an exact-match list would wave all four through.
     *
     * <p>Only a <em>populated</em> value is refused. The wizard blanks these fields rather than
     * dropping them ({@code captureShareableState}), because its state is restored slice-by-slice and
     * a missing key would make a controlled input uncontrolled; an empty string discloses nothing, so
     * refusing it would reject every well-behaved submission and leave only the malformed ones.
     */
    private static final Set<String> FORBIDDEN_DETAIL_KEY_MARKERS = Set.of("pan", "aadhaar", "aadhar");

    /** Depth-first refusal of any populated identity-number field in the object. */
    private void rejectIdentityNumbers(Object node) {
        if (node instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                if (isIdentityKey(key) && isPopulated(entry.getValue())) {
                    throw new BadRequestException(
                            "details must not carry identity numbers (found '" + key
                                    + "'); send them to PUT /service-requests/{id}/identities "
                                    + "instead, and identity documents to the vault");
                }
                rejectIdentityNumbers(entry.getValue());
            }
        } else if (node instanceof Iterable<?> items) {
            items.forEach(this::rejectIdentityNumbers);
        }
    }

    private static boolean isIdentityKey(String key) {
        String normalized = key.toLowerCase(Locale.ROOT).replace("_", "").replace("-", "");
        return FORBIDDEN_DETAIL_KEY_MARKERS.stream().anyMatch(normalized::contains);
    }

    private static boolean isPopulated(Object value) {
        return value != null && !String.valueOf(value).isBlank();
    }

    /** Contract {@code getServiceRequest} — the requester or ops. */
    @Transactional(readOnly = true)
    public ServiceRequestDto get(AuthPrincipal caller, String id) {
        return mapper.toDto(visible(caller, id));
    }

    /**
     * Contract {@code getServiceRequestChecklist} — the requester or ops (D120).
     *
     * <p>Same guard as {@link #get}, and deliberately the same <em>call</em>: the checklist is
     * folded from the document list that {@code GET /service-requests/{id}} already returns, so the
     * two can never disagree about what has been filed. Reading the vault a second time with its
     * own query would be marginally cheaper and would introduce exactly the class of bug this
     * endpoint exists to remove — a document column that says one thing while the documents tab
     * says another.
     *
     * <p>No {@code @PreAuthorize}. {@link #visible} is the guard, and it answers a stranger with
     * {@code 404} rather than {@code 403}: which service requests exist is not a fact this API
     * confirms to people who are not on them. A role annotation here would additionally lock out
     * the customer, who is the person the checklist is for.
     */
    @Transactional(readOnly = true)
    public ServiceRequestChecklistDto checklist(AuthPrincipal caller, String id) {
        return ServiceRequestChecklist.of(mapper.toDto(visible(caller, id)).documents());
    }

    /**
     * Contract {@code addServiceRequestMessage} — 201. The requester or ops.
     *
     * <p>{@code authorRole} is taken from the principal, so a customer cannot post as staff.
     */
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
        ServiceRequest request = opsAccessible(caller, id);
        ServiceRequestStatus target = ServiceRequestStatus.parse(status == null ? "" : status.trim())
                .orElseThrow(() ->
                        new BadRequestException("Unknown service request status: " + status));
        if (!target.isStaffSettable()) {
            throw new BadRequestException(
                    ("'%s' is not set directly. Share a draft to reach draft-shared, the customer "
                            + "approves it, and uploading the final document completes it.")
                            .formatted(target));
        }
        ServiceRequestStatus from = transition(request, target);
        if (target == ServiceRequestStatus.ASSIGNED) {
            request.setAssigneeId(caller.userId());
        }
        String actor = displayName(caller.userId());
        record(request, "status." + target, actor);
        audit.record(caller, "service-request.status", "service_request", request.getId().toString(),
                "from", from.wire(), "to", target.wire(), "note", note);
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
     *
     * <p><strong>The customer is told.</strong> Sharing a draft hands the decision to the requester,
     * and {@link #decideDraft} will accept it from nobody else — so a share the customer never hears
     * about stalls the request indefinitely with each side believing it is the other's move. The
     * notification goes only to the requester, because they are exactly the set of people the next
     * step is available to; a co-fill counterparty who cannot decide would only be told to go and
     * fail. It runs inside this transaction (see {@link Notifier}), so a rolled-back share cannot
     * leave behind an announcement of a draft that does not exist.
     */
    @Transactional
    public ServiceRequestDto shareDraft(AuthPrincipal caller, String id, String note,
            MultipartFile file) {
        ServiceRequest request = opsAccessible(caller, id);
        ServiceRequestStatus from = transition(request, ServiceRequestStatus.DRAFT_SHARED);
        storeDocument(caller, request, "draft", file, "draft.shared");
        audit.record(caller, "service-request.draft-shared", "service_request",
                request.getId().toString(), "from", from.wire(), "note", note);
        notifier.notify(request.getRequesterId(), "service.draft-shared",
                "Your draft is ready to review",
                "Our team has shared a draft with you. Approve it, or ask for changes.",
                ServiceRequestTypes.pageFor(request.getType()));
        return mapper.toDto(request);
    }

    /**
     * Contract {@code decideServiceRequestDraft} — <strong>the requester, and nobody else</strong>.
     *
     * <p>Staff and admin are refused here even though they can do everything else on the request.
     * That is the entire maker-checker: the person who produced the draft must not be the person
     * who accepts it, and "admin can do anything" would quietly delete the control.
     *
     * <p><strong>A rejection lands in {@code changes-requested}, not {@code in-progress} (D121),</strong>
     * and the note is written as the customer's own message. It used to do neither: the status
     * collapsed into the one a request that had never been rejected also sits in, and the note went
     * only to {@code audit_log}. Between them that left a rejection invisible from every surface a
     * customer or an operator actually reads — the request looked like ordinary work in flight and
     * nothing said what was wrong with the draft. The message goes on the thread rather than the
     * timeline because {@code ServiceRequestEvent} is an audit trail of what the server did, and
     * customer free text does not belong in one.
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
        ServiceRequestStatus target = approve
                ? ServiceRequestStatus.APPROVED
                : ServiceRequestStatus.CHANGES_REQUESTED;
        if (request.getStatus() != ServiceRequestStatus.DRAFT_SHARED) {
            throw new ConflictException(
                    "There is no draft awaiting your decision — this request is "
                            + request.getStatus() + ".");
        }
        ServiceRequestStatus from = transition(request, target);
        record(request, approve ? "draft.approved" : "draft.rejected", displayName(caller.userId()));
        if (!approve && blankToNull(note) != null) {
            messages.save(new ServiceRequestMessage(
                    request.getId(), caller.userId(), caller.role(), note.trim()));
        }
        audit.record(caller, "service-request.draft-decision", "service_request",
                request.getId().toString(), "from", from.wire(), "to", target.wire(), "note", note);
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
        ServiceRequest request = opsAccessible(caller, id);
        if (request.getStatus() != ServiceRequestStatus.APPROVED) {
            throw new ConflictException(
                    "The customer has not approved the draft yet — this request is "
                            + request.getStatus() + ".");
        }
        DocumentDto uploaded =
                storeDocument(caller, request, "final-document", file, "final-document.uploaded");
        transition(request, ServiceRequestStatus.COMPLETED);
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

    /**
     * Apply a transition or refuse it, returning the status moved from.
     *
     * <p><strong>Reaching a terminal status discards the parties' identity numbers</strong> (D151).
     * The hook lives here rather than at each ending so there is one site: {@code completed} and
     * {@code cancelled} are reachable from six places between the status endpoint, the final
     * document, the customer's cancel, the compensating write and the abandoned-checkout sweep, and a
     * retention rule enforced at five of six is not a retention rule. Both endings are real —
     * completed because the registered document now carries the numbers, cancelled because nothing
     * will ever be drafted from them.
     *
     * <p>The purge is deliberately <em>not</em> silent: a matter that held numbers says so on the
     * timeline the customer reads, because "we have discarded your Aadhaar number" is the half of a
     * retention promise that is worth showing rather than only keeping.
     */
    private ServiceRequestStatus transition(ServiceRequest request, ServiceRequestStatus target) {
        ServiceRequestStatus from = request.getStatus();
        if (!from.canTransitionTo(target)) {
            throw new ConflictException(
                    "Cannot move a service request from %s to %s.".formatted(from, target));
        }
        request.moveTo(target);
        if (target.isTerminal() && identities.purgeFor(request.getId()) > 0) {
            record(request, "identities.purged", null);
        }
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

    /**
     * Anyone on the request, or any request for ops. A stranger's is a 404, not a 403.
     *
     * <p>Package-private rather than private since D121, so {@code ServiceRequestReadReceipts} can
     * use the same guard the reads use instead of re-deriving it. One participant test, one answer.
     */
    ServiceRequest visible(AuthPrincipal caller, String id) {
        ServiceRequest request = found(id);
        if (!isOps(caller)) {
            if (!requests.isParticipant(request.getId(), caller.userId())) {
                throw NotFoundException.of("Service request");
            }
            return request;
        }
        return ServiceDeskAuthority.onCallersDesk(caller, request);
    }

    /** Any existing request, on the calling operator's own desk. For the ops-only operations. */
    private ServiceRequest opsAccessible(AuthPrincipal caller, String id) {
        return ServiceDeskAuthority.onCallersDesk(caller, found(id));
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

    // ---------------------------------------------------------------------------------------
    // The seam CoFillServiceRequests reaches through.
    //
    // Co-fill is its own use case and lives in its own service, but a co-filled rent agreement is
    // still a service request: it is filed the same way, priced the same way, paid for through the
    // same gateway and narrated onto the same timeline. Those four things belong to this class and
    // would be wrong to duplicate — a second `open()` is a second answer to "what does filing a
    // request mean", and the second answer is the one that drifts.
    //
    // Each of these is deliberately coarse. They are the operations co-fill actually needs, not
    // this class's internals made visible: `Opened`, `checkoutCustomer`, `mergeDetails`,
    // `boundedDetails` and `isOps` all stay private behind them. A seam of five one-line accessors
    // would have been the file split the size guard exists to prevent.
    // ---------------------------------------------------------------------------------------

    /**
     * File a request without opening checkout, and answer its id.
     *
     * <p>Rejects a free request, because there is nothing to defer: co-fill exists so that two
     * people can both fill in an agreement before either is asked to pay, and a desk that costs
     * nothing has no payment to arrange around.
     */
    UUID fileDeferred(AuthPrincipal caller, ServiceRequestCreate body) {
        Opened opened = open(caller, body);
        if (opened.settled() != null) {
            throw new BadRequestException("Co-fill is only supported for priced service requests.");
        }
        return opened.requestId();
    }

    /** The same request, locked for update, with the same participant guard the reads use. */
    ServiceRequest visibleForUpdate(AuthPrincipal caller, String id) {
        ServiceRequest request = Ids.parseUuid(id)
                .flatMap(requests::findByIdForUpdate)
                .orElseThrow(() -> NotFoundException.of("Service request"));
        if (!isOps(caller) && !requests.isParticipant(request.getId(), caller.userId())) {
            throw NotFoundException.of("Service request");
        }
        return request;
    }

    /** Open a gateway order for an already-filed request, as the caller. */
    PaymentGateway.PaymentOrder openOrderFor(AuthPrincipal caller, ServiceRequest request) {
        return openOrder(new Opened(null, request.getId(), request.getAmount(),
                checkoutCustomer(caller)));
    }

    /** Fold an incoming partial payload into a request's details, bounded and non-erasing. */
    Map<String, Object> mergedBoundedDetails(ServiceRequest request, Map<String, Object> incoming) {
        return mergeDetails(request.getDetails(), boundedDetails(incoming));
    }

    /** Narrate onto the timeline, attributed to a user id rather than to a name. */
    void recordBy(ServiceRequest request, String event, UUID actor) {
        record(request, event, displayName(actor));
    }
}
