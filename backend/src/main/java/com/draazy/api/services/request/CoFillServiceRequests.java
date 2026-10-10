package com.draazy.api.services.request;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.provider.PaymentGateway;
import com.draazy.api.security.AuthPrincipal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class CoFillServiceRequests {

    private final ServiceRequestRepository requests;
    private final ServiceRequestPartyRepository partyRows;
    private final CoFillParties parties;
    private final ServiceRequestService serviceRequests;
    private final ServiceRequestMapper mapper;
    private final AuditService audit;
    private final RentAgreementReadiness readiness;
    private final Notifier notifier;
    private final PaymentGateway gateway;
    private final TransactionTemplate transactions;
    private final ServiceRequestReferralCredit referralCredit;

    public CoFillServiceRequests(ServiceRequestRepository requests,
            ServiceRequestPartyRepository partyRows,
            CoFillParties parties,
            ServiceRequestService serviceRequests,
            ServiceRequestMapper mapper,
            AuditService audit,
            RentAgreementReadiness readiness,
            Notifier notifier,
            PaymentGateway gateway,
            PlatformTransactionManager transactionManager,
            ServiceRequestReferralCredit referralCredit) {
        this.requests = requests;
        this.partyRows = partyRows;
        this.parties = parties;
        this.serviceRequests = serviceRequests;
        this.mapper = mapper;
        this.audit = audit;
        this.readiness = readiness;
        this.notifier = notifier;
        this.gateway = gateway;
        this.transactions = new TransactionTemplate(transactionManager);
        this.referralCredit = referralCredit;
    }

    @Transactional
    public ServiceRequestDto createCoFill(AuthPrincipal caller, ServiceRequestCreate body,
            String role, String mobile) {
        UUID requestId = serviceRequests.fileDeferred(caller, body);
        parties.invite(caller, requestId.toString(), role, 0, mobile);

        // Re-read after invite so the DTO sees the just-written party row.
        ServiceRequest request = requests.findById(requestId).orElseThrow(() -> new IllegalStateException("Service request " + requestId
                        + " disappeared before its co-fill invitation was recorded"));
        serviceRequests.recordBy(request, "party.invited", caller.userId());
        return mapper.toDto(request, caller);
    }

    // Merge only this side; blank fields must not erase the other party's work.
    @Transactional
    public ServiceRequestDto submitPartyDetails(AuthPrincipal caller, String id,
            Map<String, Object> details) {
        ServiceRequest request = serviceRequests.visible(caller, id);

        if (caller.userId().equals(request.getRequesterId())) {
            throw new ForbiddenException(
                    "Only the invited co-fill party can submit details through this route.");
        }
        ServiceRequestParty party = partyRows.findByRequestId(request.getId()).stream().filter(p -> caller.userId().equals(p.getUserId())
                        && CoFillParties.ACCEPTED.equals(p.getStatus())).findFirst().orElseThrow(() -> new ForbiddenException(
                        "Accept the invitation first, then submit your details."));
        String side = party.getRole();
        if (request.getStatus() != ServiceRequestStatus.AWAITING_PAYMENT) {
            throw new ConflictException(
                    "This request is " + request.getStatus()
                            + " — party details may only be submitted before checkout.");
        }
        if (request.getPaymentRef() != null) {
            throw new ConflictException(
                    "Checkout is already open for this request. Ask the requester to reopen it if"
                            + " edits are needed.");
        }

        if (!ServiceRequestPricing.samePricedTerms(request.getDetails(),
                serviceRequests.mergedBoundedDetails(request, details))) {
            throw new ConflictException(
                    "The rent, deposit and term were set by the requester and the fee was priced on"
                            + " them. Ask the requester to change them.");
        }
        Map<String, Object> merged = serviceRequests.mergedBoundedDetails(request,
                ownSide(request.getType(), side, party.getPartyIndex(), request.getDetails(), details));
        RentAgreementDetailsRules.checkMerged(merged);
        request.replaceDetails(merged);
        serviceRequests.recordBy(request, "party.details-submitted", caller.userId());
        audit.record(caller, "service-request.party-details", "service_request",
                request.getId().toString());

        notifier.notify(request.getRequesterId(), "service.party-details-submitted",
                "The other side has filled in their details",
                "Open the request and pay to send it to our drafting team.",
                ServiceRequestTypes.pageFor(request.getType()));
        return mapper.toDto(requests.saveAndFlush(request), caller);
    }

    private static final Map<String, List<String>> SIDE_SUMMARY = Map.of(
            "tenant", List.of("tenants"),
            "owner", List.of("ownerName"));
    private static final Map<String, List<String>> SIDE_STATE = Map.of(
            "tenant", List.of("tenants"),
            "owner", List.of("owner", "coOwners"));

    static Map<String, Object> ownSide(String type, String side, int partyIndex,
            Map<String, Object> currentDetails, Map<String, Object> details) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(type) || details == null) {
            return details;
        }
        Map<String, Object> own = new HashMap<>();
        SIDE_SUMMARY.getOrDefault(side, List.of()).stream().filter(details::containsKey).forEach(key -> own.put(key, details.get(key)));
        Map<String, Object> ownState = new HashMap<>();
        if (details.get("_state") instanceof Map<?, ?> state) {
            SIDE_STATE.getOrDefault(side, List.of()).stream().filter(state::containsKey).forEach(key -> ownState.put(key,
                            ownStateValue(side, key, partyIndex, currentDetails, state.get(key))));
        }

        Object first = ownState.get(SIDE_STATE.get(side).getFirst());
        if (first == null || first instanceof List<?> rows && rows.isEmpty()) {
            throw new ValidationException("Fill in the " + side + " details before submitting.");
        }
        own.put("_state", ownState);
        return own;
    }

    private static Object ownStateValue(String side, String key, int partyIndex,
            Map<String, Object> currentDetails, Object value) {
        if (!"tenant".equals(side) || !"tenants".equals(key)) {
            return value;
        }
        if (!(value instanceof List<?> rows) || partyIndex >= rows.size()) {
            throw new ValidationException("Fill in the tenant details before submitting.");
        }
        Map<String, Object> currentState = ServiceRequestPricing.childObject(
                currentDetails == null ? Map.of() : currentDetails, "_state");
        List<?> currentRows = currentState.get("tenants") instanceof List<?> cur ? cur : List.of();
        List<Object> merged = new java.util.ArrayList<>(currentRows);
        while (merged.size() <= partyIndex) {
            merged.add(Map.of());
        }
        merged.set(partyIndex, rows.get(partyIndex));
        return merged;
    }

    public ServiceRequestDto openDeferredCheckout(AuthPrincipal caller, String id, String declaration) {
        ServiceRequest ready = transactions.execute(tx -> checkoutable(caller, id));
        RentAgreementDeclaration.accept(audit, caller, ready, declaration);
        String openOrder = ready.getPaymentRef();
        if (openOrder != null) {
            return resumeCheckout(caller, id, openOrder);
        }
        ServiceRequest payable = transactions.execute(tx -> spendReferralCredit(caller, id));
        if (payable.getStatus() != ServiceRequestStatus.AWAITING_PAYMENT) {
            return transactions.execute(tx -> mapper.toDto(serviceRequests.visible(caller, id), caller));
        }
        PaymentGateway.PaymentOrder order = serviceRequests.openOrderFor(caller, payable);
        return transactions.execute(tx -> {
            ServiceRequest request = checkoutable(caller, id);
            if (!request.attachOrder(order.orderId())) {
                throw new ConflictException("Checkout is already open for this request.");
            }
            return mapper.toDto(requests.saveAndFlush(request), caller).withPaymentSessionId(order.paymentSessionId());
        });
    }

    // A fully waived request has no gateway order to wait for, so it is settled as a paid one would be.
    private ServiceRequest spendReferralCredit(AuthPrincipal caller, String id) {
        ServiceRequest request = checkoutable(caller, id);
        if (referralCredit.spend(request)) {
            serviceRequests.recordBy(request, "referral-credit.applied", caller.userId());
            if (request.getAmount() == 0) {
                serviceRequests.transition(request, ServiceRequestStatus.NEW);
                serviceRequests.record(request, "payment.waived", null);
            }
            requests.saveAndFlush(request);
        }
        return request;
    }

    private ServiceRequestDto resumeCheckout(AuthPrincipal caller, String id, String orderId) {
        String session = gateway.resumeSession(orderId).orElseThrow(() -> new ConflictException(
                "This checkout can no longer be resumed. If you have just paid, it will show as paid"
                        + " in a few minutes; otherwise it closes on its own and you can file again."));
        return transactions.execute(tx -> {
            ServiceRequest request = checkoutable(caller, id);
            if (!orderId.equals(request.getPaymentRef())) {
                throw new ConflictException("Checkout changed while it was being resumed. Try again.");
            }
            return mapper.toDto(request, caller).withPaymentSessionId(session);
        });
    }

    private ServiceRequest checkoutable(AuthPrincipal caller, String id) {
        ServiceRequest request = serviceRequests.visibleForUpdate(caller, id);
        if (!caller.userId().equals(request.getRequesterId())) {
            throw new ForbiddenException(
                    "Only the person who raised this request can open checkout.");
        }
        if (request.getStatus() != ServiceRequestStatus.AWAITING_PAYMENT) {
            throw new ConflictException(
                    "Checkout may only be opened while this request is awaiting payment \u2014 it is "
                            + request.getStatus() + ".");
        }
        if (request.getAmount() == null || request.getAmount() <= 0) {
            throw new ConflictException("This request has no payable amount.");
        }
        var rows = partyRows.findByRequestId(request.getId());
        if (!rows.isEmpty()) {
            if (rows.stream().anyMatch(p -> CoFillParties.INVITED.equals(p.getStatus()))) {
                throw new ConflictException(pendingInviteMessage(request.getId()));
            }
            if (rows.stream().noneMatch(p -> CoFillParties.ACCEPTED.equals(p.getStatus()))) {
                throw new ConflictException("No invited party has accepted this request yet.");
            }
        }
        readiness.require(request);
        return request;
    }

    private String pendingInviteMessage(UUID requestId) {
        boolean unclaimed = partyRows.findByRequestId(requestId).stream().anyMatch(p -> p.isPending() && CoFillParties.INVITED.equals(p.getStatus()));
        return unclaimed
                ? "That number has not signed up yet. Once they register, the invitation reaches "
                        + "them and they can accept it."
                : "An invitation is still pending. Wait for the invited party to accept or decline.";
    }
}
