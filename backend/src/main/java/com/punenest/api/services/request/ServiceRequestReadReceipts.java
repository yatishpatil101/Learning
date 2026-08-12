package com.punenest.api.services.request;

import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.time.Instant;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read receipts on the service-request conversation (D121).
 *
 * <p>{@code markServiceRequestRead} existed in the frontend and nowhere else: the unread badge was
 * computed from a {@code localStorage} bucket, so opening the thread cleared it on that browser and
 * left it lit on every other device the same person used — and told the other side nothing at all.
 * This is the server half, so "seen" becomes a fact about the conversation rather than about a
 * browser.
 *
 * <p><strong>Its own collaborator, not a tenth method on {@link ServiceRequestService}.</strong> It
 * shares that class's guard — {@link ServiceRequestService#visible}, which is why that method is
 * package-private — and adds the only rule of its own: who counts as "the other side".
 */
@Component
class ServiceRequestReadReceipts {

    /**
     * The two sides of the thread, by {@code author_role} as V21's CHECK spells them.
     *
     * <p>Sides, not individuals. A customer opening the thread marks <em>ops</em>' messages read
     * rather than "everything I did not write", because on a co-filled agreement the other party is
     * also a customer and their message is not addressed to the reader — it is beside them, on the
     * same side of the desk. Marking it read would clear an operator's badge because a tenant looked
     * at what their landlord typed.
     */
    private static final Set<String> OPS = Set.of(Roles.Wire.STAFF, Roles.Wire.ADMIN);
    private static final Set<String> CUSTOMER = Set.of(Roles.Wire.BUYER, Roles.Wire.OWNER);

    private final ServiceRequestService requests;
    private final ServiceRequestMessageRepository messages;

    ServiceRequestReadReceipts(ServiceRequestService requests,
            ServiceRequestMessageRepository messages) {
        this.requests = requests;
        this.messages = messages;
    }

    /**
     * Contract {@code markServiceRequestRead} — 204. Anyone who can read the request.
     *
     * <p>Idempotent, and deliberately so: the client calls this every time the thread is opened, and
     * a receipt records when the message was first seen, not most recently. {@code 204} rather than a
     * count for the same reason — a body would invite the client to render "3 messages marked", which
     * is a number about the request's history rather than about anything the reader did.
     *
     * @throws com.punenest.api.common.error.NotFoundException if the request is not the caller's to
     *                                                         read — a stranger's is a 404, matching
     *                                                         every other customer read on this
     *                                                         aggregate
     */
    @Transactional
    void markRead(AuthPrincipal caller, String id) {
        ServiceRequest request = requests.visible(caller, id);
        boolean ops = OPS.contains(caller.role());
        messages.markRead(request.getId(), ops ? CUSTOMER : OPS, Instant.now());
    }
}
