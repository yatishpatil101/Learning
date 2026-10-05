package com.draazy.api.services.request;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

// Separate collaborator keeps read-receipt side rules out of ServiceRequestService.
@Component
class ServiceRequestReadReceipts {

    // Mark sides, not individuals; co-fill parties are customers, not desk recipients.
    private static final Set<String> OPS = Set.of(Roles.Wire.STAFF, Roles.Wire.MANAGER, Roles.Wire.ADMIN);
    private static final Set<String> CUSTOMER = Set.of(Roles.Wire.BUYER, Roles.Wire.OWNER);

    static final String DRAFT_SHARED = "draft.shared";
    private static final String DRAFT_OPENED = "draft.opened";

    private final ServiceRequestService requests;
    private final ServiceRequestMessageRepository messages;
    private final ServiceRequestEventRepository events;
    private final ServiceRequestDraftApprovals approvals;

    ServiceRequestReadReceipts(ServiceRequestService requests,
            ServiceRequestMessageRepository messages, ServiceRequestEventRepository events,
            ServiceRequestDraftApprovals approvals) {
        this.requests = requests;
        this.messages = messages;
        this.events = events;
        this.approvals = approvals;
    }

    // Idempotent: receipt records first seen, not latest open.
    // 204 avoids tempting clients to render historical counts.
    @Transactional
    void markRead(AuthPrincipal caller, String id) {
        ServiceRequest request = requests.visible(caller, id);
        boolean ops = OPS.contains(caller.role());
        messages.markRead(request.getId(), ops ? CUSTOMER : OPS, Instant.now());
    }

    @Transactional
    void markDraftOpened(AuthPrincipal caller, String id) {
        ServiceRequest request = requests.visible(caller, id);
        if (request.getStatus() != ServiceRequestStatus.DRAFT_SHARED) {
            throw new ConflictException("There is no draft out for review on this request.");
        }
        approvals.markOpened(caller, request);
        if (caller.userId().equals(request.getRequesterId())) {
            List<ServiceRequestEvent> timeline = events.findByRequestIdOrderByAtAsc(request.getId());
            if (!draftOpened(timeline)) {
                requests.record(request, DRAFT_OPENED, requests.displayName(caller.userId()));
            }
        }
    }

    static boolean draftOpened(List<ServiceRequestEvent> timeline) {
        boolean opened = false;
        for (ServiceRequestEvent entry : timeline) {
            if (DRAFT_SHARED.equals(entry.getEvent())) {
                opened = false;
            } else if (DRAFT_OPENED.equals(entry.getEvent())) {
                opened = true;
            }
        }
        return opened;
    }
}
