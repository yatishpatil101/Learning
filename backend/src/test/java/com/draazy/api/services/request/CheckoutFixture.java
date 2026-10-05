package com.draazy.api.services.request;

import com.draazy.api.security.AuthPrincipal;
import java.util.UUID;

/**
 * Opens the gateway order on a filed, priced request the way {@code openServiceRequestCheckout}
 * does, minus its readiness gate, for tests about what happens after checkout rather than about
 * the paperwork that earns it.
 */
public final class CheckoutFixture {

    private CheckoutFixture() {
    }

    /** @return the request's payment ref, opening an order first if it has none */
    public static String open(ServiceRequestService service, ServiceRequestRepository repo, UUID id) {
        ServiceRequest request = repo.findById(id).orElseThrow();
        if (request.getPaymentRef() != null) {
            return request.getPaymentRef();
        }
        AuthPrincipal requester = new AuthPrincipal(request.getRequesterId(), "owner", null, true, false);
        String ref = service.openOrderFor(requester, request).orderId();
        request.attachOrder(ref);
        repo.saveAndFlush(request);
        return ref;
    }
}
