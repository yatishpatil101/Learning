package com.draazy.api.services.request;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ServiceRequestPoliceIntimationsController {

    private static final String OPS = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and ";
    private static final String SERVICES_WRITE = OPS + BackOfficePermissions.REQUIRE_SERVICES_WRITE;

    private final ServiceRequestPoliceIntimations intimations;

    public ServiceRequestPoliceIntimationsController(ServiceRequestPoliceIntimations intimations) {
        this.intimations = intimations;
    }

    @PostMapping(Routes.ServiceRequests.POLICE_INTIMATION)
    @PreAuthorize(SERVICES_WRITE)
    public ServiceRequestDto confirmServiceRequestPoliceIntimation(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody(required = false) ConfirmPoliceIntimation body) {
        return intimations.confirm(principal, id, body == null ? null : body.reference(),
                body == null ? null : body.submittedOn());
    }

    public record ConfirmPoliceIntimation(@Size(max = 80) String reference, LocalDate submittedOn) {
    }
}
