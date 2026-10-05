package com.draazy.api.services.request;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Desk verdicts gate drafting/registration on verified papers.
// Stale document ids 409 so old reviews cannot bless re-uploads.
@Service
public class ServiceRequestDocumentReviews {

    private static final int REASON_MAX = 300;
    private static final int NAMED_AT_MOST = 6;

    private final ServiceRequestService requests;
    private final ServiceRequestMapper mapper;
    private final ServiceRequestDocumentReviewRepository reviews;
    private final ServiceRequestPartyRepository parties;
    private final AuditService audit;
    private final Notifier notifier;

    public ServiceRequestDocumentReviews(ServiceRequestService requests, ServiceRequestMapper mapper,
            ServiceRequestDocumentReviewRepository reviews, ServiceRequestPartyRepository parties,
            AuditService audit, Notifier notifier) {
        this.requests = requests;
        this.mapper = mapper;
        this.reviews = reviews;
        this.parties = parties;
        this.audit = audit;
        this.notifier = notifier;
    }

    // Checklist is built from the same DTO document list, so GET and checklist cannot drift.
    @Transactional(readOnly = true)
    public ServiceRequestChecklistDto checklist(AuthPrincipal caller, String id) {
        return checklistOf(requests.visible(caller, id), caller);
    }

    @Transactional
    public ServiceRequestChecklistDto review(AuthPrincipal caller, String id, String category,
            String documentId, String verdict, String reason) {
        ServiceRequest request = requests.opsAccessible(caller, id);
        if (request.getStatus().isTerminal() || request.getStatus() == ServiceRequestStatus.AWAITING_PAYMENT) {
            throw new ConflictException("Documents are reviewed on a paid, open request \u2014 this one is "
                    + request.getStatus() + ".");
        }
        requests.requireHolder(caller, request, "reviewing its documents", "the documents are theirs to review");
        String slug = category == null ? "" : category.strip().toLowerCase(Locale.ROOT);
        String name = ServiceRequestChecklist.itemsFor(request).get(slug);
        String wanted = verdict == null ? "" : verdict.strip().toLowerCase(Locale.ROOT);
        String why = reason == null || reason.isBlank() ? null : reason.strip();
        validate(name, slug, wanted, why);
        String current = ServiceRequestChecklist.newestByCategory(mapper.toDto(request, caller).documents()).get(slug);
        if (current == null) {
            throw new ConflictException("Nothing is filed under " + name + " yet.");
        }
        if (!current.equals(documentId)) {
            throw new ConflictException("A newer copy of " + name + " was uploaded \u2014 review that one.");
        }
        UUID document = UUID.fromString(current);
        ServiceRequestDocumentReview row = reviews.findByDocumentId(document).orElseGet(() -> new ServiceRequestDocumentReview(request.getId(), document));
        row.decide(wanted, ServiceRequestDocumentReview.VERIFIED.equals(wanted) ? null : why,
                caller.userId(), Instant.now());
        reviews.save(row);
        requests.record(request, "document." + wanted, requests.displayName(caller.userId()));
        audit.record(caller, "service-request.document-reviewed", "service_request",
                request.getId().toString(), "category", slug, "document", current, "verdict", wanted,
                "reason", row.getReason());
        if (!row.verified()) {
            tellUploader(request, slug, name, why);
        }
        return checklistOf(request, caller);
    }

    void requireVerified(AuthPrincipal caller, ServiceRequest request, String act) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            return;
        }
        List<String> open = checklistOf(request, caller).items().stream().filter(item -> !ServiceRequestDocumentReview.VERIFIED.equals(item.review())).map(ServiceRequestChecklistDto.Item::name).toList();
        if (!open.isEmpty()) {
            String named = String.join(", ", open.subList(0, Math.min(open.size(), NAMED_AT_MOST)));
            String more = open.size() > NAMED_AT_MOST ? " and " + (open.size() - NAMED_AT_MOST) + " more" : "";
            throw new ConflictException("Verify every document before " + act + ": " + named + more + ".");
        }
    }

    private ServiceRequestChecklistDto checklistOf(ServiceRequest request, AuthPrincipal caller) {
        Map<String, ServiceRequestDocumentReview> byDocument = reviews.findByServiceRequestId(request.getId()).stream().collect(Collectors.toMap(r -> r.getDocumentId().toString(), Function.identity()));
        return ServiceRequestChecklist.of(request, mapper.toDto(request, caller).documents(), byDocument,
                fileableSides(request, caller));
    }

    private Set<String> fileableSides(ServiceRequest request, AuthPrincipal caller) {
        List<ServiceRequestParty> all = parties.findByRequestId(request.getId());
        boolean requester = caller.userId().equals(request.getRequesterId());
        Set<String> own = all.stream().filter(p -> caller.userId().equals(p.getUserId()) && CoFillParties.ACCEPTED.equals(p.getStatus())).map(ServiceRequestParty::getRole).collect(Collectors.toCollection(LinkedHashSet::new));
        if (!requester && own.isEmpty()
                && Roles.isBackOffice(caller.role())) {
            return CoFillParties.ROLES;
        }
        if (requester) {
            Set<String> live = all.stream().filter(p -> !CoFillParties.DECLINED.equals(p.getStatus())).map(ServiceRequestParty::getRole).collect(Collectors.toSet());
            CoFillParties.ROLES.stream().filter(role -> !live.contains(role)).forEach(own::add);
        }
        return own;
    }

    private static void validate(String name, String slug, String verdict, String reason) {
        if (name == null) {
            throw new ValidationException("'" + slug + "' is not on this request's checklist.");
        }
        if (!ServiceRequestDocumentReview.VERIFIED.equals(verdict)
                && !ServiceRequestDocumentReview.REJECTED.equals(verdict)) {
            throw new ValidationException("verdict must be 'verified' or 'rejected'.");
        }
        if (ServiceRequestDocumentReview.REJECTED.equals(verdict)
                && (reason == null || reason.length() > REASON_MAX)) {
            throw new ValidationException("Say why the document is rejected, in at most " + REASON_MAX
                    + " characters \u2014 the customer re-uploads from it.");
        }
    }

    private void tellUploader(ServiceRequest request, String slug, String name, String reason) {
        String side = RentAgreementReadiness.sideOf(slug);
        Set<UUID> recipients = parties.findByRequestId(request.getId()).stream().filter(p -> p.getUserId() != null && CoFillParties.ACCEPTED.equals(p.getStatus())
                        && p.getRole().equals(side)).map(ServiceRequestParty::getUserId).collect(Collectors.toCollection(LinkedHashSet::new));
        if (recipients.isEmpty()) {
            recipients.add(request.getRequesterId());
        }
        recipients.forEach(user -> notifier.notify(user, "service.document-rejected",
                "Re-upload " + name, reason, ServiceRequestTypes.pageFor(request.getType())));
    }
}
