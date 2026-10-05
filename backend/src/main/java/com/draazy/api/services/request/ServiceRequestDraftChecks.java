package com.draazy.api.services.request;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.security.AuthPrincipal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ServiceRequestDraftChecks {

    private final ServiceRequestDraftCheckRepository checks;
    private final ServiceRequestDraftApprovals approvals;
    private final RentAgreementOverlaps overlaps;
    private final ServiceRequestService requests;
    private final ServiceRequestMapper mapper;
    private final AuditService audit;
    private final Notifier notifier;

    ServiceRequestDraftChecks(ServiceRequestDraftCheckRepository checks,
            ServiceRequestDraftApprovals approvals, RentAgreementOverlaps overlaps,
            ServiceRequestService requests, ServiceRequestMapper mapper,
            AuditService audit, Notifier notifier) {
        this.checks = checks;
        this.approvals = approvals;
        this.overlaps = overlaps;
        this.requests = requests;
        this.mapper = mapper;
        this.audit = audit;
        this.notifier = notifier;
    }

    @Transactional
    boolean holdIfRisky(AuthPrincipal caller, ServiceRequest request, int draftVersion) {
        List<String> reasons = riskReasons(request);
        if (reasons.isEmpty()) {
            return false;
        }
        checks.save(new ServiceRequestDraftCheck(request.getId(), draftVersion, reasons, caller.userId()));
        requests.record(request, "draft.check-pending", requests.displayName(caller.userId()));
        audit.record(caller, "service-request.draft-check-pending", "service_request",
                request.getId().toString(), "version", String.valueOf(draftVersion),
                "reasons", String.join(",", reasons));
        return true;
    }

    @Transactional
    public ServiceRequestDto decide(AuthPrincipal caller, String id, String decision, String note) {
        ServiceRequest request = requests.opsAccessible(caller, id);
        int version = approvals.currentVersion(request);
        ServiceRequestDraftCheck check = checks.findByRequestIdAndDraftVersion(request.getId(), version).orElseThrow(() -> new ConflictException("No draft is waiting for a second check."));
        if (!ServiceRequestDraftCheck.PENDING.equals(check.getStatus())) {
            throw new ConflictException("This draft check is already " + check.getStatus() + ".");
        }
        if (caller.userId().equals(check.getSharedBy()) || caller.userId().equals(request.getAssigneeId())) {
            throw new ForbiddenException("A different operator must check this risky draft.");
        }
        switch (decision == null ? "" : decision.trim().toLowerCase()) {
            case "release" -> release(caller, request, check, version);
            case "send-back" -> sendBack(caller, request, check, note);
            default -> throw new BadRequestException("decision must be 'release' or 'send-back'");
        }
        return mapper.toDto(request, caller);
    }

    ServiceRequestDto.DraftCheck summary(ServiceRequest request, ServiceRequestDraftCheck check,
            Map<UUID, String> names) {
        if (check == null) {
            return null;
        }
        return new ServiceRequestDto.DraftCheck(check.getDraftVersion(), check.getStatus(),
                check.reasonsList(), check.getNote(), names.get(check.getSharedBy()),
                names.get(check.getCheckedBy()), check.getCheckedAt());
    }

    boolean hideDraftFromCustomer(ServiceRequest request, List<ServiceRequestDraftCheck> all) {
        int version = approvals.currentVersion(request);
        return all.stream().anyMatch(c -> c.getRequestId().equals(request.getId())
                && c.getDraftVersion() == version && ServiceRequestDraftCheck.PENDING.equals(c.getStatus()));
    }

    private void release(AuthPrincipal caller, ServiceRequest request, ServiceRequestDraftCheck check,
            int version) {
        check.release(caller.userId());
        ServiceRequestStatus from = requests.transition(request, ServiceRequestStatus.DRAFT_SHARED);
        requests.record(request, ServiceRequestReadReceipts.DRAFT_SHARED, requests.displayName(caller.userId()));
        audit.record(caller, "service-request.draft-check-release", "service_request",
                request.getId().toString(), "from", from.wire(), "version", String.valueOf(version));
        notifier.notify(request.getRequesterId(), "service.draft-shared",
                "Your draft is ready to review",
                "Our team has shared a checked draft with you. Approve it, or ask for changes.",
                ServiceRequestTypes.pageFor(request.getType()));
    }

    private void sendBack(AuthPrincipal caller, ServiceRequest request, ServiceRequestDraftCheck check,
            String rawNote) {
        String note = rawNote == null ? "" : rawNote.trim();
        if (note.isEmpty()) {
            throw new BadRequestException("Say what the holder should fix before release.");
        }
        check.sendBack(caller.userId(), note);
        requests.record(request, "draft.check-returned", requests.displayName(caller.userId()));
        audit.record(caller, "service-request.draft-check-returned", "service_request",
                request.getId().toString(), "note", note);
    }

    private List<String> riskReasons(ServiceRequest request) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            return List.of();
        }
        Map<String, Object> details = request.getDetails() == null ? Map.of() : request.getDetails();
        Map<String, Object> state = ServiceRequestPricing.childObject(details, "_state");
        List<String> reasons = new ArrayList<>();
        Long rent = ServiceRequestPricing.rupees(details.get("rent"),
                ServiceRequestPricing.childObject(state, "terms").get("rent"));
        if (rent != null && rent >= 50_000) {
            reasons.add("rent_ge_50000");
        }
        if (state.get("coOwners") instanceof List<?> owners && !owners.isEmpty()) {
            reasons.add("co_owner");
        }
        if ("poa".equalsIgnoreCase(String.valueOf(
                ServiceRequestPricing.childObject(state, "owner").get("capacity")))) {
            reasons.add("poa");
        }
        if (hasNriOrForeign(state.get("licensors")) || hasNriOrForeign(state.get("tenants"))) {
            reasons.add("nri_or_foreign");
        }
        if (!overlaps.overlapsFor(request).isEmpty()) {
            reasons.add("overlap");
        }
        return reasons;
    }

    private static boolean hasNriOrForeign(Object rows) {
        if (!(rows instanceof List<?> list)) {
            return false;
        }
        return list.stream().anyMatch(row -> row instanceof Map<?, ?> m
                && ("nri".equalsIgnoreCase(String.valueOf(m.get("residency")))
                || "foreign".equalsIgnoreCase(String.valueOf(m.get("residency")))));
    }
}
