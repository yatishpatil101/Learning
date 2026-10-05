package com.draazy.api.services.request;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import org.springframework.stereotype.Component;

// Desk checks are centralized so subresource controllers share the same staff ownership gate.
@Component
public class ServiceRequestDesks {

    private final ServiceRequestRepository requests;
    private final AccountPermissions accountPermissions;

    ServiceRequestDesks(ServiceRequestRepository requests, AccountPermissions accountPermissions) {
        this.requests = requests;
        this.accountPermissions = accountPermissions;
    }

    public void requireOnCallersDesk(AuthPrincipal caller, String requestId) {
        if (Roles.Wire.ADMIN.equals(caller.role()) || Roles.Wire.MANAGER.equals(caller.role())) {
            return;
        }
        ServiceRequest request = Ids.parseUuid(requestId).flatMap(requests::findById).orElseThrow(() -> NotFoundException.of("Service request"));
        ServiceDeskAuthority.onCallersDesk(caller, request, accountPermissions.desksFor(caller));
    }
}
