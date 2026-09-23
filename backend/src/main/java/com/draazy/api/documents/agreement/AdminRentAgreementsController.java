package com.draazy.api.documents.agreement;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Separate from {@link MeRentAgreementsController} because only the ops desk may say an agreement
 * was registered — {@code FlatmateTrustReconciler} badges a host off that word with no human. */
@RestController
public class AdminRentAgreementsController {

    private static final String SERVICES_WRITE = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN
            + "') and " + BackOfficePermissions.REQUIRE_SERVICES_WRITE;

    private final RentAgreementService agreementService;

    public AdminRentAgreementsController(RentAgreementService agreementService) {
        this.agreementService = agreementService;
    }

    /** {@code PATCH /admin/rent-agreements/{id}} (contract {@code transitionRentAgreement}). */
    @PatchMapping(Routes.Moderation.RENT_AGREEMENT_BY_ID)
    @PreAuthorize(SERVICES_WRITE)
    public RentAgreementDto transitionRentAgreement(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody TransitionRequest body) {
        return agreementService.transition(principal, id, body.status(), body.documentUrl());
    }

    /** {@code documentUrl} is optional even for {@code registered}: the registered copy often arrives
     * days later, and holding the status back would make a registered tenancy read as unregistered. */
    public record TransitionRequest(@NotBlank @Size(max = 32) String status,
            @Size(max = 512) String documentUrl) {
    }
}
