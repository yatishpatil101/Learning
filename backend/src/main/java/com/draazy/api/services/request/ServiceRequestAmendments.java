package com.draazy.api.services.request;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.PaymentGateway;
import com.draazy.api.security.AuthPrincipal;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ServiceRequestAmendments {

    private static final Logger log = LoggerFactory.getLogger(ServiceRequestAmendments.class);

    private static final int REASON_MAX = 300;

    private static final Set<ServiceRequestStatus> AMENDABLE = EnumSet.of(ServiceRequestStatus.ASSIGNED,
            ServiceRequestStatus.IN_PROGRESS, ServiceRequestStatus.CHANGES_REQUESTED);

    // The terms mirrored at the top of details as numbers; the rest live only in _state.terms.
    private static final Set<String> FLAT_TERMS = Set.of("rent", "deposit", "nrDeposit", "months", "regArea");

    private final ServiceRequestService requests;
    private final ServiceRequestRepository requestRows;
    private final ServiceRequestAmendmentRepository amendments;
    private final ServiceRequestRefundRepository refunds;
    private final ServiceRequestPartyRepository parties;
    private final ServiceRequestPricing pricing;
    private final ServiceRequestMapper mapper;
    private final PaymentGateway gateway;
    private final UserRepository users;
    private final AuditService audit;
    private final Notifier notifier;
    private final TransactionTemplate transactions;

    public ServiceRequestAmendments(ServiceRequestService requests, ServiceRequestRepository requestRows,
            ServiceRequestAmendmentRepository amendments, ServiceRequestRefundRepository refunds,
            ServiceRequestPartyRepository parties, ServiceRequestPricing pricing,
            ServiceRequestMapper mapper, PaymentGateway gateway, UserRepository users, AuditService audit,
            Notifier notifier, PlatformTransactionManager transactionManager) {
        this.requests = requests;
        this.requestRows = requestRows;
        this.amendments = amendments;
        this.refunds = refunds;
        this.parties = parties;
        this.pricing = pricing;
        this.mapper = mapper;
        this.gateway = gateway;
        this.users = users;
        this.audit = audit;
        this.notifier = notifier;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    public record Terms(Long rent, Long deposit, Long nrDeposit, Long months, BigDecimal increment,
            Long incrementEvery, String regArea) {

        Map<String, Object> changes() {
            Map<String, Object> out = new LinkedHashMap<>();
            if (rent != null) {
                out.put("rent", rent);
            }
            if (deposit != null) {
                out.put("deposit", deposit);
            }
            if (nrDeposit != null) {
                out.put("nrDeposit", nrDeposit);
            }
            if (months != null) {
                out.put("months", months);
            }
            if (increment != null) {
                out.put("increment", increment.stripTrailingZeros().toPlainString());
            }
            if (incrementEvery != null) {
                out.put("incrementEvery", incrementEvery);
            }
            if (regArea != null) {
                out.put("regArea", "rural".equals(regArea) ? RegistrationArea.RURAL : RegistrationArea.URBAN);
            }
            return out;
        }
    }

    @Transactional
    public ServiceRequestDto propose(AuthPrincipal caller, String id, Terms terms, String reason) {
        ServiceRequest request = requests.opsAccessible(caller, id);
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            throw new ConflictException("Only a rent agreement is priced on its terms.");
        }
        requests.requireHolder(caller, request, "amending its terms", "the terms are theirs to amend");
        request = locked(request.getId());
        amendable(request);
        if (amendments.findOpenForUpdate(request.getId()).isPresent()) {
            throw new ConflictException("Revised terms are already waiting for the customer. Withdraw them first.");
        }
        Map<String, Object> changes = terms == null ? Map.of() : terms.changes();
        String why = reason == null ? "" : reason.strip();
        if (why.isEmpty() || why.length() > REASON_MAX) {
            throw new ValidationException("Say why the terms change, in at most " + REASON_MAX
                    + " characters \u2014 the customer accepts from it.");
        }
        Map<String, Object> next = amended(request.getDetails(), changes);
        if (changes.isEmpty() || ServiceRequestPricing.samePricedTerms(request.getDetails(), next)) {
            throw new ValidationException("These are the terms already priced. Change the draft without an amendment.");
        }
        long before = (request.getAmount() == null ? 0L : request.getAmount()) - refunds.approvedTotal(request.getId());
        long after = pricing.repriced(before, request.getDetails(), next);
        ServiceRequestAmendment amendment = amendments.save(new ServiceRequestAmendment(
                request.getId(), changes, why, before, after, caller.userId()));
        requests.record(request, "amendment.proposed", requests.displayName(caller.userId()));
        audit.record(caller, "service-request.amendment-proposed", "service_request",
                request.getId().toString(), "amendment", amendment.getId().toString(),
                "amountBefore", before, "amountAfter", after, "reason", why);
        long delta = amendment.delta();
        notifier.notify(request.getRequesterId(), "service.amendment-proposed",
                "Revised terms to accept",
                delta > 0 ? "The new terms add " + Notifier.rupees(delta) + " of charges. Accept and pay to continue."
                        : "Accept the new terms so our team can revise your draft.",
                ServiceRequestTypes.pageFor(request.getType()));
        notifyOtherParties(request, "service.amendment-proposed", "Revised terms proposed",
                "Our team proposed new terms. " + displayName(request.getRequesterId())
                        + " decides whether to accept them.");
        return mapper.toDto(request, caller);
    }

    @Transactional
    public ServiceRequestDto withdraw(AuthPrincipal caller, String id, String amendmentId) {
        ServiceRequest request = requests.opsAccessible(caller, id);
        requests.requireHolder(caller, request, "withdrawing its revised terms", "the terms are theirs to amend");
        request = locked(request.getId());
        ServiceRequestAmendment amendment = open(request, amendmentId);
        amendment.close(ServiceRequestAmendment.WITHDRAWN, caller.userId(), Instant.now());
        requests.record(request, "amendment.withdrawn", requests.displayName(caller.userId()));
        audit.record(caller, "service-request.amendment-withdrawn", "service_request",
                request.getId().toString(), "amendment", amendment.getId().toString(),
                "orderOpen", amendment.getPaymentRef() != null);
        notifier.notify(request.getRequesterId(), "service.amendment-withdrawn",
                "Revised terms withdrawn", "Our team withdrew the revised terms. Nothing more is due for them.",
                ServiceRequestTypes.pageFor(request.getType()));
        return mapper.toDto(request, caller);
    }

    public ServiceRequestDto accept(AuthPrincipal caller, String id, String amendmentId) {
        ServiceRequestDto applied = transactions.execute(tx -> {
            ServiceRequestAmendment amendment = acceptable(caller, id, amendmentId);
            if (amendment.delta() > 0) {
                return null;
            }
            ServiceRequest request = locked(amendment.getServiceRequestId());
            audit.record(caller, "service-request.amendment-accepted", "service_request", id,
                    "amendment", amendmentId, "delta", amendment.delta());
            apply(request, amendment, caller.userId());
            return mapper.toDto(request, caller);
        });
        if (applied != null) {
            return applied;
        }
        String openOrder = transactions.execute(tx -> acceptable(caller, id, amendmentId).getPaymentRef());
        if (openOrder != null) {
            Optional<String> session = gateway.resumeSession(openOrder);
            if (session.isPresent()) {
                return transactions.execute(tx -> {
                    ServiceRequestAmendment amendment = acceptable(caller, id, amendmentId);
                    if (!openOrder.equals(amendment.getPaymentRef())) {
                        throw new ConflictException("Checkout changed while it was being resumed. Try again.");
                    }
                    return mapper.toDto(locked(amendment.getServiceRequestId()), caller)
                            .withPaymentSessionId(session.get());
                });
            }
            if (gateway.paid(openOrder)) {
                throw new ConflictException("This payment has gone through and will show in a few minutes.");
            }
            transactions.executeWithoutResult(tx -> releaseExpiredOrder(caller, id, amendmentId, openOrder));
        }
        long delta = transactions.execute(tx -> acceptable(caller, id, amendmentId).delta());
        String phone = users.findById(caller.userId()).map(User::getMobile).orElse(null);
        PaymentGateway.PaymentOrder order = gateway.createOrder(delta,
                "service-request-amendment:" + amendmentId,
                new PaymentGateway.Customer(caller.userId().toString(), phone));
        if (order.orderId() == null || order.orderId().isBlank()) {
            throw new IllegalStateException("Payment gateway returned no order id");
        }
        return transactions.execute(tx -> {
            ServiceRequestAmendment amendment = acceptable(caller, id, amendmentId);
            if (amendment.getPaymentRef() != null || amendment.delta() != delta) {
                throw new ConflictException("Checkout is already open for these terms.");
            }
            amendment.attachOrder(order.orderId());
            amendments.saveAndFlush(amendment);
            audit.record(caller, "service-request.amendment-accepted", "service_request", id,
                    "amendment", amendmentId, "delta", delta);
            return mapper.toDto(locked(amendment.getServiceRequestId()), caller).withPaymentSessionId(order.paymentSessionId());
        });
    }

    @Transactional
    public boolean applyWebhookOutcome(String orderId, boolean paid, long providerAmount) {
        if (orderId == null || orderId.isBlank()) {
            return false;
        }

        // Request row first, as every other path here takes it, so the two locks cannot deadlock.
        UUID requestId = amendments.findRequestIdByPaymentRef(orderId).orElse(null);
        if (requestId == null) {
            return false;
        }
        ServiceRequest request = locked(requestId);
        ServiceRequestAmendment amendment = amendments.findByPaymentRefForUpdate(orderId).orElse(null);
        if (amendment == null) {
            log.error("Amendment order {} was released while its payment was being settled; reconcile it"
                    + " against service request {}", orderId, requestId);
            return true;
        }
        if (paid && providerAmount > 0 && providerAmount != amendment.delta()) {
            log.error("Amount mismatch on amendment {}: billed {} but provider charged {}",
                    amendment.getId(), amendment.delta(), providerAmount);
        }
        boolean firstPayment = paid && amendment.getPaidAt() == null;
        if (firstPayment) {
            amendment.markPaid(Instant.now());
        }
        if (!amendment.open() || !AMENDABLE.contains(request.getStatus())) {
            if (firstPayment && !ServiceRequestAmendment.APPLIED.equals(amendment.getStatus())) {
                keepAsCredit(request, amendment);
            }
            return true;
        }
        if (paid) {
            apply(request, amendment, null);
        } else {
            amendment.releaseOrder();
            requests.record(request, "amendment.payment-failed", null);
        }
        return true;
    }

    // The money is real, so it joins what was paid and can be refunded; only the terms stay unapplied.
    private void keepAsCredit(ServiceRequest request, ServiceRequestAmendment amendment) {
        request.charge(amendment.delta());
        requestRows.saveAndFlush(request);
        requests.record(request, "amendment.payment-unapplied", null);
        log.warn("Payment settled for amendment {} on service request {}, but the amendment is {} and the request"
                + " {}; {} is held as a refundable credit.", amendment.getId(), request.getId(),
                amendment.getStatus(), request.getStatus(), amendment.delta());
        notifier.notify(request.getRequesterId(), "service.amendment-credit",
                "Payment received for withdrawn terms",
                Notifier.rupees(amendment.delta()) + " reached us after those terms were withdrawn. Our team"
                        + " will refund it.", ServiceRequestTypes.pageFor(request.getType()));
        if (request.getAssigneeId() != null) {
            notifier.notify(request.getAssigneeId(), "service.amendment-credit",
                    "Refund due on a withdrawn amendment",
                    Notifier.rupees(amendment.delta()) + " was paid for terms that are no longer open.",
                    "/ops/drafting-desk");
        }
    }

    private void releaseExpiredOrder(AuthPrincipal caller, String id, String amendmentId, String openOrder) {
        ServiceRequestAmendment amendment = acceptable(caller, id, amendmentId);
        if (!openOrder.equals(amendment.getPaymentRef())) {
            return;
        }
        amendment.releaseOrder();
        amendments.saveAndFlush(amendment);
        requests.record(locked(amendment.getServiceRequestId()), "amendment.checkout-expired", null);
    }

    private void notifyOtherParties(ServiceRequest request, String type, String title, String body) {
        parties.findByRequestId(request.getId()).stream()
                .filter(p -> CoFillParties.ACCEPTED.equals(p.getStatus()) && p.getUserId() != null
                        && !p.getUserId().equals(request.getRequesterId()))
                .forEach(p -> notifier.notify(p.getUserId(), type, title, body,
                        ServiceRequestTypes.pageFor(request.getType())));
    }

    private String displayName(UUID userId) {
        return Objects.requireNonNullElse(requests.displayName(userId), "The requester");
    }

    void requireNoneOpen(ServiceRequest request) {
        if (amendments.findByServiceRequestIdAndStatus(request.getId(), ServiceRequestAmendment.PROPOSED).isPresent()) {
            throw new ConflictException("The customer has not accepted the revised terms yet, so the draft"
                    + " cannot be shared on them.");
        }
    }

    private void apply(ServiceRequest request, ServiceRequestAmendment amendment, UUID by) {
        request.replaceDetails(amended(request.getDetails(), amendment.getTerms()));
        if (amendment.delta() > 0) {
            request.charge(amendment.delta());
        }
        amendment.close(ServiceRequestAmendment.APPLIED, by, Instant.now());
        requestRows.saveAndFlush(request);
        requests.record(request, "amendment.applied", by == null ? null : requests.displayName(by));
        notifyOtherParties(request, "service.amendment-applied", "Terms revised",
                "The revised terms were accepted. The draft will be updated to match.");
        if (request.getAssigneeId() != null) {
            notifier.notify(request.getAssigneeId(), "service.amendment-applied",
                    "Revised terms accepted", "The customer accepted the revised terms. Share the revised draft.",
                    "/ops/drafting-desk");
        }
    }

    private ServiceRequestAmendment acceptable(AuthPrincipal caller, String id, String amendmentId) {
        ServiceRequest request = requests.visibleForUpdate(caller, id);
        if (!caller.userId().equals(request.getRequesterId())) {
            throw new ForbiddenException("Only the person who raised this request can accept revised terms.");
        }
        amendable(request);
        return open(request, amendmentId);
    }

    private ServiceRequestAmendment open(ServiceRequest request, String amendmentId) {
        return amendments.findOpenForUpdate(request.getId()).filter(a -> a.getId().toString().equals(amendmentId)).orElseThrow(() -> NotFoundException.of("Open amendment"));
    }

    private static void amendable(ServiceRequest request) {
        if (!AMENDABLE.contains(request.getStatus())) {
            throw new ConflictException("Terms are amended while the desk is drafting \u2014 this request is "
                    + request.getStatus() + ".");
        }
    }

    private ServiceRequest locked(UUID requestId) {
        return requestRows.findByIdForUpdate(requestId).orElseThrow(() -> NotFoundException.of("Service request"));
    }

    static Map<String, Object> amended(Map<String, Object> details, Map<String, Object> changes) {
        Map<String, Object> next = new LinkedHashMap<>(details == null ? Map.of() : details);
        Map<String, Object> state = new LinkedHashMap<>(ServiceRequestPricing.childObject(next, "_state"));
        Map<String, Object> terms = new LinkedHashMap<>(ServiceRequestPricing.childObject(state, "terms"));
        changes.forEach((key, value) -> {
            terms.put(key, String.valueOf(value));
            if (FLAT_TERMS.contains(key)) {
                next.put(key, value);
            }
        });
        state.put("terms", terms);
        next.put("_state", state);
        return next;
    }
}
