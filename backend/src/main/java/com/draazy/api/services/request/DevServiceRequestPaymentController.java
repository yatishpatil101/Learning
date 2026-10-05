package com.draazy.api.services.request;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.LocalOnly;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@LocalOnly
class DevServiceRequestPaymentController {

    private final ServiceRequestService service;

    DevServiceRequestPaymentController(ServiceRequestService service) {
        this.service = service;
    }

    @PostMapping(Routes.ServiceRequests.PAYMENT_SIMULATE)
    ServiceRequestDto simulate(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestParam(defaultValue = "paid") String outcome) {
        return service.simulateMockPayment(principal, id, paid(outcome));
    }

    private static boolean paid(String outcome) {
        return switch (outcome) {
            case "paid" -> true;
            case "failed" -> false;
            default -> throw new BadRequestException("outcome must be paid or failed");
        };
    }
}
