package com.draazy.api.services.request;

import com.draazy.api.catalog.fee.LeaveAndLicenceCharges;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.provider.PaymentGateway;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Refunds are open until GRAS duty is paid.
// After duty, only service fee and lower-amendment overpay remain refundable.
@Service
public class ServiceRequestRefunds {

    private static final Logger log = LoggerFactory.getLogger(ServiceRequestRefunds.class);

    private static final int TEXT_MAX = 300;

    private static final Set<String> GATEWAY_REFUSED = Set.of("CANCELLED", "FAILED");

    private static final Pattern GATEWAY_REFUND_ID = Pattern.compile("rf_([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})");

    private final ServiceRequestService requests;
    private final ServiceRequestRepository requestRows;
    private final ServiceRequestRefundRepository refunds;
    private final ServiceRequestAmendmentRepository amendments;
    private final ServiceRequestEventRepository events;
    private final ServiceRequestRegistrationRepository registrations;
    private final PaymentGateway gateway;
    private final AuditService audit;
    private final Notifier notifier;

    public ServiceRequestRefunds(ServiceRequestService requests, ServiceRequestRepository requestRows,
            ServiceRequestRefundRepository refunds, ServiceRequestAmendmentRepository amendments,
            ServiceRequestEventRepository events, ServiceRequestRegistrationRepository registrations,
            PaymentGateway gateway, AuditService audit, Notifier notifier) {
        this.requests = requests;
        this.requestRows = requestRows;
        this.refunds = refunds;
        this.amendments = amendments;
        this.events = events;
        this.registrations = registrations;
        this.gateway = gateway;
        this.audit = audit;
        this.notifier = notifier;
    }

    public record RefundSummaryDto(long paid, long refunded, long refundableBeforeDuty,
            long refundableAfterDuty, boolean dutyPaidOnRecord, List<Item> refunds) {

        public record Item(String id, long amount, String status, boolean dutyPaid, String grn,
                String reason, String requestedBy, String decidedBy, String decisionNote,
                String gatewayRefundId, Instant requestedAt, Instant decidedAt, boolean mine) {
        }
    }

    // A gateway order and what it took; a refund draws on one order only.
    private record Leg(String orderId, long amount) {
    }

    @Transactional(readOnly = true)
    public RefundSummaryDto summary(AuthPrincipal caller, String id) {
        return summaryOf(caller, rentAgreement(caller, id));
    }

    @Transactional
    public RefundSummaryDto request(AuthPrincipal caller, String id, long amount, boolean dutyPaidClaimed,
            String grnClaimed, String reason) {
        ServiceRequest request = rentAgreement(caller, id);
        requests.requireHolder(caller, request, "asking for a refund", "the refund is theirs to ask for");
        String why = text(reason, "Say why the money goes back");
        if (!events.existsByRequestIdAndEvent(request.getId(), "payment.received")) {
            throw new ConflictException("Nothing has been paid on this request, so there is nothing to refund.");
        }
        Optional<String> registeredGrn = registeredGrn(request);
        boolean dutyPaid = dutyPaidClaimed || registeredGrn.isPresent();
        String grn = registeredGrn.orElseGet(() -> dutyPaid ? claimedGrn(grnClaimed) : null);
        request = locked(request.getId());
        if (refunds.findOpenForUpdate(request.getId()).isPresent()) {
            throw new ConflictException("A refund is already waiting for approval. Decide it first.");
        }
        List<ServiceRequestRefund> history = refunds.findByServiceRequestIdOrderByCreatedAtDesc(request.getId());
        Leg leg = leg(request, history, amount, dutyPaid);
        ServiceRequestRefund refund = refunds.saveAndFlush(new ServiceRequestRefund(request.getId(),
                leg.orderId(), amount, dutyPaid, grn, why, caller.userId()));
        audit.record(caller, "service-request.refund-requested", "service_request", id,
                "refund", refund.getId().toString(), "amount", amount, "dutyPaid", dutyPaid, "reason", why);
        return summaryOf(caller, request);
    }

    @Transactional
    public RefundSummaryDto approve(AuthPrincipal caller, String id, String refundId, String note) {
        ServiceRequest request = locked(rentAgreement(caller, id).getId());
        ServiceRequestRefund refund = open(request, refundId);
        if (caller.userId().equals(refund.getRequestedBy())) {
            throw new ForbiddenException("You asked for this refund, so a colleague has to approve it.");
        }
        List<ServiceRequestRefund> others = refunds.findByServiceRequestIdOrderByCreatedAtDesc(request.getId()).stream().filter(r -> r != refund).toList();
        boolean dutyPaid = refund.isDutyPaid() || registeredGrn(request).isPresent();
        if (!refund.getOrderId().equals(leg(request, others, refund.getAmount(), dutyPaid).orderId())) {
            throw new ConflictException("The payments behind this request changed. Reject it and ask again.");
        }
        String gatewayRef = gateway.refund(refund.getOrderId(), refund.getAmount(),
                "rf_" + refund.getId().toString().replace("-", ""), refund.getReason());
        try {
            refund.approve(gatewayRef, caller.userId(), optional(note));
            refunds.saveAndFlush(refund);
        } catch (RuntimeException unrecorded) {
            log.error("Refund {} of {} on order {} was sent to the gateway as {} but could not be recorded."
                    + " Reconcile it by hand.", refund.getId(), refund.getAmount(), refund.getOrderId(), gatewayRef);
            throw unrecorded;
        }
        requests.record(request, "refund.approved", requests.displayName(caller.userId()));
        cancelWhenFullyRefunded(request, caller);
        audit.record(caller, "service-request.refund-approved", "service_request", id,
                "refund", refundId, "amount", refund.getAmount(), "gatewayRefund", gatewayRef);
        notifier.notify(request.getRequesterId(), "service.refund-approved",
                Notifier.rupees(refund.getAmount()) + " refund on its way",
                "It goes back to the card or account you paid with. Banks usually take 5\u20137 working days.",
                ServiceRequestTypes.pageFor(request.getType()));
        return summaryOf(caller, request);
    }

    /** Applies the gateway's refund status callback; false when the refund id is not one of ours. */
    @Transactional
    public boolean applyWebhookOutcome(String merchantRefundId, String providerStatus) {
        UUID refundId = refundIdOf(merchantRefundId);
        ServiceRequestRefund refund = refundId == null ? null : refunds.findById(refundId).orElse(null);
        if (refund == null) {
            return false;
        }
        ServiceRequest request = locked(refund.getServiceRequestId());
        if (!ServiceRequestRefund.APPROVED.equals(refund.getStatus()) || !GATEWAY_REFUSED.contains(providerStatus)) {
            return true;
        }
        refund.markFailed();
        refunds.saveAndFlush(refund);
        requests.record(request, "refund.failed", null);
        audit.record("system", "admin", "service-request.refund-failed", "service_request",
                request.getId().toString());
        log.error("Gateway {} refund {} of {} on order {}; the money has not gone back. Ask again or refund by hand.",
                providerStatus, refund.getId(), refund.getAmount(), refund.getOrderId());
        if (refund.getRequestedBy() != null) {
            notifier.notify(refund.getRequestedBy(), "service.refund-failed",
                    Notifier.rupees(refund.getAmount()) + " refund did not go through",
                    "The payment gateway cancelled it. It can be requested again.", "/ops/drafting-desk");
        }
        return true;
    }

    @Transactional
    public RefundSummaryDto reject(AuthPrincipal caller, String id, String refundId, String note) {
        ServiceRequest request = locked(rentAgreement(caller, id).getId());
        ServiceRequestRefund refund = open(request, refundId);
        refund.reject(caller.userId(), text(note, "Say why the refund is refused"));
        refunds.saveAndFlush(refund);
        audit.record(caller, "service-request.refund-rejected", "service_request", id,
                "refund", refundId, "note", refund.getDecisionNote());
        return summaryOf(caller, request);
    }

    // The refund that took everything back leaves nothing to deliver, so the request ends with it.
    private void cancelWhenFullyRefunded(ServiceRequest request, AuthPrincipal caller) {
        if (refunds.approvedTotal(request.getId()) < paid(request)
                || !request.getStatus().canTransitionTo(ServiceRequestStatus.CANCELLED)) {
            return;
        }
        requests.transition(request, ServiceRequestStatus.CANCELLED);
        amendments.findOpenForUpdate(request.getId())
                .ifPresent(open -> open.close(ServiceRequestAmendment.WITHDRAWN, caller.userId(), Instant.now()));
        requests.record(request, "refund.cancelled-request", requests.displayName(caller.userId()));
        notifier.notify(request.getRequesterId(), "service.refund-cancelled",
                "Request cancelled", "Everything you paid is being refunded, so this request is closed.",
                ServiceRequestTypes.pageFor(request.getType()));
    }

    private static UUID refundIdOf(String merchantRefundId) {
        Matcher m = merchantRefundId == null ? null : GATEWAY_REFUND_ID.matcher(merchantRefundId);
        return m == null || !m.matches() ? null
                : UUID.fromString(m.group(1) + "-" + m.group(2) + "-" + m.group(3) + "-" + m.group(4) + "-" + m.group(5));
    }

    private ServiceRequest rentAgreement(AuthPrincipal caller, String id) {
        ServiceRequest request = requests.opsAccessible(caller, id);
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            throw new ConflictException("Only a paid rent agreement is refunded here.");
        }
        return request;
    }

    private Leg leg(ServiceRequest request, List<ServiceRequestRefund> history, long amount, boolean dutyPaid) {
        if (amount < 1) {
            throw new ValidationException("A refund is at least \u20b91.");
        }
        long ceiling = refundable(request, history, dutyPaid);
        if (amount > ceiling) {
            throw new ValidationException("At most \u20b9" + ceiling + " can be refunded"
                    + (dutyPaid ? " once the stamp duty is paid: the statutory charges are spent." : "."));
        }
        Map<String, Long> taken = approved(history).stream().collect(Collectors.groupingBy(ServiceRequestRefund::getOrderId,
                        Collectors.summingLong(ServiceRequestRefund::getAmount)));
        long largest = 0;
        for (Leg leg : legs(request)) {
            long left = leg.amount() - taken.getOrDefault(leg.orderId(), 0L);
            if (left >= amount) {
                return leg;
            }
            largest = Math.max(largest, left);
        }
        throw new ValidationException("No single payment covers \u20b9" + amount + ". Refund at most \u20b9"
                + largest + " now and the rest as a second refund.");
    }

    private long refundable(ServiceRequest request, List<ServiceRequestRefund> history, boolean dutyPaid) {
        long spent = 0;
        if (dutyPaid) {
            LeaveAndLicenceCharges.Charges quoted = ServiceRequestPricing.quotedCharges(request.getDetails());
            spent = quoted == null ? 0 : quoted.total();
        }
        return Math.max(0, paid(request) - refunded(history) - spent);
    }

    // The first checkout, then each paid top-up; amount is their sum, so the first is the rest.
    private List<Leg> legs(ServiceRequest request) {
        List<Leg> topUps = amendments.findByServiceRequestIdAndPaymentRefNotNull(request.getId()).stream()
                .filter(a -> a.delta() > 0 && (ServiceRequestAmendment.APPLIED.equals(a.getStatus()) || a.getPaidAt() != null))
                .map(a -> new Leg(a.getPaymentRef(), a.delta())).toList();
        List<Leg> out = new ArrayList<>();
        if (request.getPaymentRef() != null) {
            out.add(new Leg(request.getPaymentRef(), paid(request) - topUps.stream().mapToLong(Leg::amount).sum()));
        }
        out.addAll(topUps);
        return out;
    }

    private static long paid(ServiceRequest request) {
        return request.getAmount() == null ? 0 : request.getAmount();
    }

    private static long refunded(List<ServiceRequestRefund> history) {
        return approved(history).stream().mapToLong(ServiceRequestRefund::getAmount).sum();
    }

    private static List<ServiceRequestRefund> approved(List<ServiceRequestRefund> history) {
        return history.stream().filter(r -> ServiceRequestRefund.APPROVED.equals(r.getStatus())).toList();
    }

    private Optional<String> registeredGrn(ServiceRequest request) {
        return registrations.findByServiceRequestIdIn(List.of(request.getId())).stream().map(ServiceRequestRegistration::getGrn).findFirst();
    }

    private static String claimedGrn(String grn) {
        String valid = RegistrationParticulars.normalisedGrn(grn);
        if (valid == null) {
            throw new ValidationException("Paid duty is refunded only against its GRAS challan: give the GRN (MH\u2026).");
        }
        return valid;
    }

    private ServiceRequestRefund open(ServiceRequest request, String refundId) {
        return refunds.findOpenForUpdate(request.getId()).filter(r -> r.getId().toString().equals(refundId)).orElseThrow(() -> NotFoundException.of("Open refund"));
    }

    private ServiceRequest locked(UUID requestId) {
        return requestRows.findByIdForUpdate(requestId).orElseThrow(() -> NotFoundException.of("Service request"));
    }

    private RefundSummaryDto summaryOf(AuthPrincipal caller, ServiceRequest request) {
        List<ServiceRequestRefund> history = refunds.findByServiceRequestIdOrderByCreatedAtDesc(request.getId());
        boolean paidOnRecord = events.existsByRequestIdAndEvent(request.getId(), "payment.received");
        boolean registered = registeredGrn(request).isPresent();
        return new RefundSummaryDto(paidOnRecord ? paid(request) : 0, refunded(history),
                paidOnRecord ? refundable(request, history, registered) : 0,
                paidOnRecord ? refundable(request, history, true) : 0,
                registered,
                history.stream().map(r -> new RefundSummaryDto.Item(r.getId().toString(), r.getAmount(),
                        r.getStatus(), r.isDutyPaid(), r.getGrn(), r.getReason(), name(r.getRequestedBy()),
                        name(r.getDecidedBy()), r.getDecisionNote(), r.getGatewayRefundId(), r.getCreatedAt(),
                        r.getDecidedAt(), caller.userId().equals(r.getRequestedBy()))).toList());
    }

    private String name(UUID userId) {
        return userId == null ? null : requests.displayName(userId);
    }

    private static String text(String value, String ask) {
        String out = value == null ? "" : value.strip();
        if (out.isEmpty() || out.length() > TEXT_MAX) {
            throw new ValidationException(ask + ", in at most " + TEXT_MAX + " characters.");
        }
        return out;
    }

    private static String optional(String value) {
        String out = value == null ? "" : value.strip();
        if (out.length() > TEXT_MAX) {
            throw new ValidationException("Keep the note to " + TEXT_MAX + " characters.");
        }
        return out.isEmpty() ? null : out;
    }
}
