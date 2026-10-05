package com.draazy.api.services.request;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import com.draazy.api.services.request.ServiceRequestRefunds.RefundSummaryDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ServiceRequestRefundsController {

    private static final String OPS = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and ";
    private static final String SERVICES_READ = OPS + BackOfficePermissions.REQUIRE_SERVICES_READ;
    private static final String SERVICES_WRITE = OPS + BackOfficePermissions.REQUIRE_SERVICES_WRITE;

    private final ServiceRequestRefunds refunds;

    public ServiceRequestRefundsController(ServiceRequestRefunds refunds) {
        this.refunds = refunds;
    }

    @GetMapping(Routes.ServiceRequests.REFUNDS)
    @PreAuthorize(SERVICES_READ)
    public RefundSummaryDto getServiceRequestRefunds(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return refunds.summary(principal, id);
    }

    @PostMapping(Routes.ServiceRequests.REFUNDS)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize(SERVICES_WRITE)
    public RefundSummaryDto requestServiceRequestRefund(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody RefundRequest body) {
        return refunds.request(principal, id, body.amount(), Boolean.TRUE.equals(body.dutyPaid()), body.grn(),
                body.reason());
    }

    @PostMapping(Routes.ServiceRequests.REFUND_APPROVE)
    @PreAuthorize(SERVICES_WRITE)
    public RefundSummaryDto approveServiceRequestRefund(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @PathVariable String refundId, @RequestBody(required = false) Decision body) {
        return refunds.approve(principal, id, refundId, body == null ? null : body.note());
    }

    @PostMapping(Routes.ServiceRequests.REFUND_REJECT)
    @PreAuthorize(SERVICES_WRITE)
    public RefundSummaryDto rejectServiceRequestRefund(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @PathVariable String refundId, @RequestBody(required = false) Decision body) {
        return refunds.reject(principal, id, refundId, body == null ? null : body.note());
    }

    public record RefundRequest(@NotNull @Positive Long amount, Boolean dutyPaid, @Size(max = 25) String grn,
            @NotBlank @Size(max = 300) String reason) {
    }

    public record Decision(String note) {
    }
}
