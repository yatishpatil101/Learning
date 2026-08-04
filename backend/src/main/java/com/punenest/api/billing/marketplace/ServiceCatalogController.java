package com.punenest.api.billing.marketplace;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The paid-services price list and the caller's own orders. */
@RestController
public class ServiceCatalogController {

    private final ServiceOrderService service;

    public ServiceCatalogController(ServiceOrderService service) {
        this.service = service;
    }

    /** {@code GET /service-catalog} (contract {@code listServiceCatalog}) — public. */
    @GetMapping(Routes.ServiceCatalog.BASE)
    public List<ServiceOfferingDto> listCatalog() {
        return service.listCatalog();
    }

    /** {@code GET /me/service-orders} (contract {@code listServiceOrders}). */
    @GetMapping(Routes.ServiceCatalog.ORDERS)
    public List<ServiceOrderDto> listOrders(@CurrentUser AuthPrincipal principal) {
        return service.listOrders(principal);
    }

    /**
     * {@code POST /me/service-orders} (contract {@code createServiceOrder}) — 201.
     *
     * @param idempotencyKey the contract's {@code Idempotency-Key}; a repeat returns the original row
     */
    @PostMapping(Routes.ServiceCatalog.ORDERS)
    @ResponseStatus(HttpStatus.CREATED)
    public ServiceOrderDto create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ServiceOrderCreate body,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return service.create(principal, body, idempotencyKey);
    }
}
