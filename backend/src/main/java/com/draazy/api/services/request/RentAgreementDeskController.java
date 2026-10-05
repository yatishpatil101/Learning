package com.draazy.api.services.request;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

// Desk check for registered-copy tenancy rows.
// It stays here because operator permission is a service-desk decision.
@RestController
public class RentAgreementDeskController {

    private static final String SERVICES_READ = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN
            + "') and " + BackOfficePermissions.REQUIRE_SERVICES_READ;

    private static final String REGISTRATIONS_WRITE = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN
            + "') and " + BackOfficePermissions.REQUIRE_REGISTRATIONS_WRITE;

    private final RentAgreementRegistration registration;
    private final RentAgreementOverlaps overlaps;

    public RentAgreementDeskController(RentAgreementRegistration registration, RentAgreementOverlaps overlaps) {
        this.registration = registration;
        this.overlaps = overlaps;
    }

    @GetMapping(Routes.ServiceRequests.RENT_AGREEMENTS)
    @PreAuthorize(SERVICES_READ)
    public List<RentAgreementRecordDto> listServiceRequestRentAgreements(
            @CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return registration.forRequest(principal, id);
    }

    @GetMapping(Routes.ServiceRequests.OVERLAPS)
    @PreAuthorize(SERVICES_READ)
    public List<RentAgreementOverlapDto> listServiceRequestOverlaps(
            @CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return overlaps.forRequest(principal, id);
    }

    @PatchMapping(Routes.Moderation.RENT_AGREEMENT_BY_ID)
    @PreAuthorize(REGISTRATIONS_WRITE)
    public RentAgreementRecordDto transitionRentAgreement(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody TransitionRequest body) {
        return registration.transition(principal, id, body.status());
    }

    public record TransitionRequest(@NotBlank @Size(max = 32) String status) {
    }
}
