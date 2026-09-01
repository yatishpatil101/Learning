package com.draazy.api.services.request;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.provider.PaymentGateway;
import com.draazy.api.security.AuthPrincipal;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Arranging an agreement between two people who both have to fill part of it in.
 *
 * <p><strong>The use case, and why it is a service of its own.</strong> An ordinary service request
 * is one person asking the desk for something: they describe it, they pay, ops works it. A rent
 * agreement is not that. Two people are party to it, each knows half of what the draft needs, and
 * neither should have to read the other's Aadhaar number down a phone line so that one of them can
 * type it into a form. So the request is filed unpaid, the second party is invited, they fill their
 * own half against their own account, and only then is anybody asked to pay.
 *
 * <p>That reordering — <em>invite, fill, then pay</em> against the ordinary <em>fill, pay, then
 * work</em> — is the whole of what this class contains. It sits beside {@link ServiceRequestService}
 * rather than inside it because the two answer different questions: that one owns what a service
 * request <em>is</em>, this one owns how a two-sided one is <em>arranged</em>. Splitting on the seam
 * between them is what package-structure.md §4.1 asks for, and the alternative — a
 * {@code ServiceRequestCoFillHelper} holding the same code — would have been the same file in two
 * pieces, still read together, with the responsibility still in the parent.
 *
 * <p><strong>What it deliberately does not own.</strong> Filing the row, pricing it, opening the
 * gateway order and narrating the timeline all still belong to {@link ServiceRequestService} and are
 * reached through a small package-private seam there. A co-filled rent agreement is a service
 * request; a second definition of what filing one means is a second definition that drifts.
 *
 * <p><strong>Invitations are not here either.</strong> {@link CoFillParties} owns the party rows —
 * who was invited, whether they answered, and the V107 pending state where the invitation is
 * addressed to a mobile number rather than to an account. This class is the request-shaped half of
 * co-fill and that one is the person-shaped half.
 */
@Service
public class CoFillServiceRequests {

    private final ServiceRequestRepository requests;
    private final ServiceRequestPartyRepository partyRows;
    private final CoFillParties parties;
    private final ServiceRequestService serviceRequests;
    private final ServiceRequestMapper mapper;
    private final AuditService audit;

    public CoFillServiceRequests(ServiceRequestRepository requests,
            ServiceRequestPartyRepository partyRows,
            CoFillParties parties,
            ServiceRequestService serviceRequests,
            ServiceRequestMapper mapper,
            AuditService audit) {
        this.requests = requests;
        this.partyRows = partyRows;
        this.parties = parties;
        this.serviceRequests = serviceRequests;
        this.mapper = mapper;
        this.audit = audit;
    }

    /**
     * Contract {@code createCoFillServiceRequest} — file a priced request without opening checkout,
     * and invite the second party.
     *
     * <p>The row is committed as {@code awaiting-payment} with no {@code payment_ref}: invisible to
     * ops on exactly the same rule as any other unpaid rent agreement, but not yet bound to a
     * gateway order either. That distinction is the point of the whole flow. An order opened now
     * would start a payment clock against a form that is still half empty, and the requester would
     * be paying for a draft neither party could yet complete.
     *
     * <p>Checkout is opened later through {@link #openDeferredCheckout}, once the counterparty has
     * accepted and submitted their side.
     */
    @Transactional
    public ServiceRequestDto createCoFill(AuthPrincipal caller, ServiceRequestCreate body,
            String role, String mobile) {
        UUID requestId = serviceRequests.fileDeferred(caller, body);
        parties.invite(caller, requestId.toString(), role, mobile);
        // Re-read rather than carry the entity across: `invite` may have written a pending party
        // row, and the DTO carries the party list, so the request has to be seen after that write
        // and not before it.
        ServiceRequest request = requests.findById(requestId)
                .orElseThrow(() -> new IllegalStateException("Service request " + requestId
                        + " disappeared before its co-fill invitation was recorded"));
        serviceRequests.recordBy(request, "party.invited", caller.userId());
        return mapper.toDto(request);
    }

    /**
     * Contract {@code submitServiceRequestPartyDetails} — the accepted second party submits their
     * half of the details, before checkout is opened.
     *
     * <p>Only theirs. The merge is non-erasing, so a key they leave blank keeps whatever the
     * requester put there: the two halves of the form are filled by two people at two times, and a
     * whole-payload replace would let whoever saved last quietly blank the other's work.
     */
    @Transactional
    public ServiceRequestDto submitPartyDetails(AuthPrincipal caller, String id,
            Map<String, Object> details) {
        ServiceRequest request = serviceRequests.visible(caller, id);
        // The requester has their own route. Rejecting them here is not pedantry: this route skips
        // the requester-side validation the ordinary update performs, and its whole authorisation
        // rests on the caller being the *other* party.
        if (caller.userId().equals(request.getRequesterId())) {
            throw new ForbiddenException(
                    "Only the invited co-fill party can submit details through this route.");
        }
        if (!partyRows.existsByRequestIdAndUserIdAndStatus(
                request.getId(), caller.userId(), CoFillParties.ACCEPTED)) {
            throw new ForbiddenException(
                    "Accept the invitation first, then submit your details.");
        }
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
        request.replaceDetails(serviceRequests.mergedBoundedDetails(request, details));
        serviceRequests.recordBy(request, "party.details-submitted", caller.userId());
        audit.record(caller, "service-request.party-details", "service_request",
                request.getId().toString());
        return mapper.toDto(requests.saveAndFlush(request));
    }

    /**
     * Contract {@code openServiceRequestCheckout} — the requester opens checkout once every
     * invitation has been answered.
     *
     * <p>The guards read as a list but they are one rule stated six ways: <em>nobody pays for a
     * draft that is not ready to be drafted.</em> Read under a row lock, because two taps on a slow
     * connection would otherwise open two live gateway orders against one request, and the second
     * one is a real charge nobody can explain afterwards.
     *
     * <p>An unanswered invitation blocks checkout whether or not it was ever claimed, and both cases
     * are named separately in the message. "Waiting for them to sign up" and "waiting for them to
     * reply" are different situations for the requester: the first is fixed by nudging somebody to
     * register, the second by nudging them to open an invitation they already have. A single message
     * covering both would leave them guessing which.
     */
    @Transactional
    public ServiceRequestDto openDeferredCheckout(AuthPrincipal caller, String id) {
        ServiceRequest request = serviceRequests.visibleForUpdate(caller, id);
        if (!caller.userId().equals(request.getRequesterId())) {
            throw new ForbiddenException(
                    "Only the person who raised this request can open checkout.");
        }
        if (request.getStatus() != ServiceRequestStatus.AWAITING_PAYMENT) {
            throw new ConflictException(
                    "Checkout may only be opened while this request is awaiting payment — it is "
                            + request.getStatus() + ".");
        }
        if (request.getPaymentRef() != null) {
            throw new ConflictException("Checkout is already open for this request.");
        }
        if (request.getAmount() == null || request.getAmount() <= 0) {
            throw new ConflictException("This request has no payable amount.");
        }
        if (partyRows.countByRequestIdAndStatus(request.getId(), CoFillParties.ACCEPTED) == 0) {
            throw new ConflictException(
                    "Wait for the invited party to accept before opening checkout.");
        }
        if (partyRows.existsByRequestIdAndStatus(request.getId(), CoFillParties.INVITED)) {
            throw new ConflictException(pendingInviteMessage(request.getId()));
        }
        PaymentGateway.PaymentOrder order = serviceRequests.openOrderFor(caller, request);
        if (!request.attachOrder(order.orderId())) {
            throw new ConflictException("Checkout is already open for this request.");
        }
        return mapper.toDto(requests.saveAndFlush(request))
                .withPaymentSessionId(order.paymentSessionId());
    }

    /** Which of the two waits the requester is actually in. */
    private String pendingInviteMessage(UUID requestId) {
        boolean unclaimed = partyRows.findByRequestId(requestId).stream()
                .anyMatch(p -> p.isPending() && CoFillParties.INVITED.equals(p.getStatus()));
        return unclaimed
                ? "That number has not signed up yet. Once they register, the invitation reaches "
                        + "them and they can accept it."
                : "An invitation is still pending. Wait for the invited party to accept or decline.";
    }
}
