package com.draazy.api.services.request;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.security.AuthPrincipal;
import java.time.LocalDate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ServiceRequestPoliceIntimations {

    private final ServiceRequestService requests;
    private final ServiceRequestPoliceIntimationRepository intimations;
    private final ServiceRequestMapper mapper;
    private final AuditService audit;

    public ServiceRequestPoliceIntimations(ServiceRequestService requests,
            ServiceRequestPoliceIntimationRepository intimations,
            ServiceRequestMapper mapper,
            AuditService audit) {
        this.requests = requests;
        this.intimations = intimations;
        this.mapper = mapper;
        this.audit = audit;
    }

    @Transactional
    public ServiceRequestDto confirm(AuthPrincipal caller, String id, String reference, LocalDate submittedOn) {
        ServiceRequest request = requests.opsAccessible(caller, id);
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            throw new ConflictException("Police intimation is tracked only for rent agreements.");
        }
        if (request.getStatus() != ServiceRequestStatus.COMPLETED) {
            throw new ConflictException("Police intimation is confirmed after the registered copy is uploaded.");
        }
        requests.requireHolder(caller, request, "confirming police intimation",
                "police intimation is theirs to confirm");
        LocalDate submitted = submittedOn;
        if (submitted != null && submitted.isAfter(LocalDate.now(PlatformTime.IST))) {
            throw new ValidationException("The police-intimation date cannot be in the future.");
        }
        String ref = blankToNull(reference);
        ServiceRequestPoliceIntimation row = intimations.findByServiceRequestId(request.getId()).orElseGet(() -> new ServiceRequestPoliceIntimation(request.getId()));
        row.confirm(caller.userId(), ref, submitted);
        intimations.saveAndFlush(row);
        requests.record(request, "police-intimation.confirmed", requests.displayName(caller.userId()));
        audit.record(caller, "service-request.police-intimation-confirmed", "service_request", id,
                "reference", ref, "submittedOn", submitted == null ? null : submitted.toString());
        return mapper.toDto(request, caller);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
