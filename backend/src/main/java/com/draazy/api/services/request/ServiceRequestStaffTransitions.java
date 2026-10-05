package com.draazy.api.services.request;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ServiceRequestStaffTransitions {

    private final ServiceRequestService requests;
    private final ServiceRequestMessageRepository messages;
    private final ServiceRequestMapper mapper;
    private final AuditService audit;
    private final Notifier notifier;

    public ServiceRequestStaffTransitions(ServiceRequestService requests,
            ServiceRequestMessageRepository messages,
            ServiceRequestMapper mapper,
            AuditService audit,
            Notifier notifier) {
        this.requests = requests;
        this.messages = messages;
        this.mapper = mapper;
        this.audit = audit;
        this.notifier = notifier;
    }

    // Assignment and acknowledgement are one act; no assigning work to someone else by id.
    @Transactional
    public ServiceRequestDto updateStatus(AuthPrincipal caller, String id, String status, String note) {
        ServiceRequest request = requests.opsAccessible(caller, id);
        ServiceRequestStatus target = ServiceRequestStatus.parse(status == null ? "" : status.trim()).orElseThrow(() ->
                        new BadRequestException("Unknown service request status: " + status));
        if (!target.isStaffSettable()) {
            throw new BadRequestException(
                    ("'%s' is not set directly. Share a draft to reach draft-shared, the customer "
                            + "approves it, and uploading the final document completes it.").formatted(target));
        }
        String reason = reasonFor(target, note);
        UUID heldBy = request.getAssigneeId();
        boolean takes = target == ServiceRequestStatus.ASSIGNED
                || (target == ServiceRequestStatus.IN_PROGRESS && heldBy == null);
        if (target != ServiceRequestStatus.CANCELLED) {
            refuseSeizure(caller, heldBy);
        }
        ServiceRequestStatus from = requests.transition(request, target);
        if (takes) {
            request.setAssigneeId(caller.userId());
        }
        String actor = requests.displayName(caller.userId());
        requests.record(request, "status." + target, actor);
        audit.record(caller, "service-request.status", "service_request", request.getId().toString(),
                "from", from.wire(), "to", target.wire(), "note", note,
                "heldBy", heldBy == null ? null : heldBy.toString());
        if (target == ServiceRequestStatus.CANCELLED) {
            announceCancellation(caller, request, reason);
        }
        return mapper.toDto(request, caller);
    }

    // The shared StatusUpdate schema cannot make `note` required for one target, so it is enforced here.
    private static String reasonFor(ServiceRequestStatus target, String note) {
        String reason = note == null || note.isBlank() ? null : note.trim();
        if (target == ServiceRequestStatus.CANCELLED && reason == null) {
            throw new BadRequestException(
                    "Say why this request is being cancelled — the customer is told the reason.");
        }
        return reason;
    }

    // Managers/admins are exempt: there is no release verb, so a leaver's matter must stay drainable.
    private void refuseSeizure(AuthPrincipal caller, UUID heldBy) {
        if (heldBy == null || heldBy.equals(caller.userId())
                || Roles.Wire.ADMIN.equals(caller.role()) || Roles.Wire.MANAGER.equals(caller.role())) {
            return;
        }
        String holder = requests.displayName(heldBy);
        throw new ConflictException(
                "%s is already working this request. Ask them to hand it over, or ask an admin to reassign it.".formatted(holder == null ? "Another operator" : holder));
    }

    // Runs in the caller's transaction (see Notifier), so a rolled-back cancel announces nothing.
    private void announceCancellation(AuthPrincipal caller, ServiceRequest request, String reason) {
        messages.save(new ServiceRequestMessage(
                request.getId(), caller.userId(), caller.role(), reason));
        notifier.notify(request.getRequesterId(), "service.cancelled",
                "Your request was cancelled",
                "Our team cancelled this request: " + reason,
                ServiceRequestTypes.pageFor(request.getType()));
    }
}
