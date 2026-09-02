package com.draazy.api.billing.marketplace;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The paid-services price list, the caller's own orders, and the order lifecycle (D58).
 *
 * <p><strong>Two audiences on one aggregate.</strong> The catalogue is public and the order
 * collection is {@code /me/}-scoped. Of the three lifecycle verbs, {@code PATCH /status} is ops'
 * and carries the role guard; {@code accept} and {@code cancel} are the customer's and carry none,
 * because their guard is ownership — the service resolves the order by (id, caller) and refuses a
 * staff caller outright. That asymmetry is what stops the desk that quotes a job from also
 * accepting the quote.
 */
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

    /**
     * {@code PATCH /service-orders/{id}/status} (contract {@code updateServiceOrderStatus},
     * {@code x-roles: [staff, admin]}) — quote an order and drive it to completion (D58).
     *
     * <p>{@code amount} rides on this body rather than a separate quote endpoint because setting
     * the price <em>is</em> the {@code quoted} transition; the service refuses it on every other
     * target. See {@link ServiceOrderService#updateStatus}.
     */
    @PatchMapping(Routes.ServiceCatalog.ORDER_STATUS)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
            + BackOfficePermissions.REQUIRE_SERVICES_WRITE)
    public ServiceOrderDto updateOrderStatus(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody OrderStatusRequest body) {
        return service.updateStatus(principal, id, body.status(), body.amount());
    }

    /**
     * {@code POST /me/service-orders/{id}/accept} (contract {@code acceptServiceOrder}) — 200.
     *
     * <p><strong>No {@code @PreAuthorize}, deliberately</strong>, following
     * {@code ServiceRequestsController#cancel}: the guard is ownership, which is stronger than a
     * role, and the service turns ops away outright. A separate verb rather than opening
     * {@code scheduled} to the customer through {@code PATCH /status} — handing a customer a status
     * field is handing them every status the field will ever accept.
     */
    @PostMapping(Routes.ServiceCatalog.ORDER_ACCEPT)
    public ServiceOrderDto acceptOrder(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return service.accept(principal, id);
    }

    /**
     * {@code POST /me/service-orders/{id}/cancel} (contract {@code cancelServiceOrder}) — 200. The
     * customer's own, and only while the crew has not started.
     */
    @PostMapping(Routes.ServiceCatalog.ORDER_CANCEL)
    public ServiceOrderDto cancelOrder(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return service.cancel(principal, id);
    }

    /**
     * Body of {@code updateServiceOrderStatus} (schema {@code ServiceOrderStatusUpdate}).
     *
     * <p>{@code amount} is a boxed {@code Long} on purpose: absent and zero are different answers,
     * and the service has to be able to tell "no price was sent" from "the price is nought". The
     * conditional rule — required on a quote, forbidden otherwise — cannot be expressed in an
     * annotation, so it lives in the service as a 422.
     */
    public record OrderStatusRequest(@NotBlank String status, Long amount) {
    }
}
