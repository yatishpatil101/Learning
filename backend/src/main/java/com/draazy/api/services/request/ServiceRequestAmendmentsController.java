package com.draazy.api.services.request;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ServiceRequestAmendmentsController {

    private static final String SERVICES_WRITE = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN
            + "') and " + BackOfficePermissions.REQUIRE_SERVICES_WRITE;

    private final ServiceRequestAmendments amendments;

    public ServiceRequestAmendmentsController(ServiceRequestAmendments amendments) {
        this.amendments = amendments;
    }

    @PostMapping(Routes.ServiceRequests.AMENDMENTS)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize(SERVICES_WRITE)
    public ServiceRequestDto proposeServiceRequestAmendment(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody AmendmentRequest body) {
        return amendments.propose(principal, id, new ServiceRequestAmendments.Terms(body.rent(),
                body.deposit(), body.nrDeposit(), body.months(), body.increment(), body.regArea()),
                body.reason());
    }

    @PostMapping(Routes.ServiceRequests.AMENDMENT_WITHDRAW)
    @PreAuthorize(SERVICES_WRITE)
    public ServiceRequestDto withdrawServiceRequestAmendment(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @PathVariable String amendmentId) {
        return amendments.withdraw(principal, id, amendmentId);
    }

    // Customer endpoint has no role guard; service still refuses non-requesters.
    @PostMapping(Routes.ServiceRequests.AMENDMENT_ACCEPT)
    public ServiceRequestDto acceptServiceRequestAmendment(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @PathVariable String amendmentId) {
        return amendments.accept(principal, id, amendmentId);
    }

    public record AmendmentRequest(@Positive Long rent, @PositiveOrZero Long deposit,
            @PositiveOrZero Long nrDeposit, @Positive Long months,
            @DecimalMin("0") @DecimalMax("100") BigDecimal increment,
            @Pattern(regexp = "urban|rural") String regArea,
            @NotBlank @Size(max = 300) String reason) {
    }
}
