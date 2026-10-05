package com.draazy.api.provider;

import com.draazy.api.common.payments.CheckoutTtl;
import com.draazy.api.provider.cashfree.CashfreeClient;
import com.draazy.api.provider.cashfree.CashfreeProperties;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

public interface PaymentGateway {

    // Prefer `#createOrder(long, String, Customer)` so Cashfree can prefill and notify the real payer.
    default PaymentOrder createOrder(long amountInr, String reference) {
        return createOrder(amountInr, reference, null);
    }

    PaymentOrder createOrder(long amountInr, String reference, Customer customer);

    Optional<String> resumeSession(String orderId);

    String refund(String orderId, long amountInr, String refundId, String note);

    /** A created payment order. {@code paymentSessionId} is single-use and must not be stored. */
    record PaymentOrder(String orderId, String paymentSessionId) {
    }

    /** {@code phone} may be null — the payer authenticates with their own instrument regardless. */
    record Customer(String id, String phone) {
    }
}

/** Deterministic fake order, no external call, so the pay flow demos without a merchant account. */
// The real Cashfree rail.
// The order id is ours because it is echoed on the webhook and is the only link back to the row.
@Component
@ConditionalOnProperty(prefix = "draazy.providers.cashfree", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class MockPaymentGateway implements PaymentGateway {

    @Override
    public PaymentOrder createOrder(long amountInr, String reference, Customer customer) {
        String orderId = "mock_order_" + UUID.randomUUID();
        return new PaymentOrder(orderId, "mock_session_" + UUID.randomUUID());
    }

    @Override
    public Optional<String> resumeSession(String orderId) {
        return Optional.of("mock_session_" + UUID.randomUUID());
    }

    @Override
    public String refund(String orderId, long amountInr, String refundId, String note) {
        return "mock_refund_" + refundId;
    }
}

// The real Cashfree rail.
// Vendor orders use our id so webhooks link back and expire with our sweep TTL.
@Component
@ConditionalOnProperty(prefix = "draazy.providers.cashfree", name = "enabled", havingValue = "true")
class CashfreePaymentGateway implements PaymentGateway {

    /** The Payment Gateway product is versioned separately from Secure ID (KYC). */
    private static final String API_VERSION = "2025-01-01";

    private static final String PLACEHOLDER_PHONE = "9999999999";

    private static final String NOTIFY_URL_REQUIREMENT =
            "draazy.providers.cashfree.notify-url (CASHFREE_NOTIFY_URL) must be blank or an "
                    + "absolute https URL; Cashfree posts settlement data to it.";

    private final CashfreeClient cashfree;
    private final CheckoutTtl ttl;
    private final String notifyUrl;

    CashfreePaymentGateway(CashfreeClient cashfree, CheckoutTtl ttl, CashfreeProperties props) {
        this.cashfree = cashfree;
        this.ttl = ttl;
        this.notifyUrl = requireHttpsOrBlank(props.notifyUrl());
    }

    // Cashfree POSTs the phone, amount and HMAC here, so a typo'd `http://` would put all of it in cleartext.
    private static String requireHttpsOrBlank(String configured) {
        if (configured == null || configured.isBlank()) {
            return "";
        }
        String trimmed = configured.trim();
        URI parsed;
        try {
            parsed = new URI(trimmed);
        } catch (URISyntaxException malformed) {
            throw new IllegalStateException(NOTIFY_URL_REQUIREMENT + " Got: " + trimmed, malformed);
        }

        // equalsIgnoreCase because RFC 3986 makes the scheme case-insensitive and URI does not fold
        // it: a guard meant to catch a typo must not itself invent one.
        if (!"https".equalsIgnoreCase(parsed.getScheme()) || parsed.getHost() == null) {
            throw new IllegalStateException(NOTIFY_URL_REQUIREMENT + " Got: " + trimmed);
        }
        return trimmed;
    }

    @Override
    public PaymentOrder createOrder(long amountInr, String reference, Customer customer) {
        String orderId = "dz_" + UUID.randomUUID();
        String customerId = customer != null && customer.id() != null && !customer.id().isBlank()
                ? customer.id()
                : sanitise(reference);
        String phone = customer != null && customer.phone() != null && !customer.phone().isBlank()
                ? customer.phone()
                : PLACEHOLDER_PHONE;

        OrderResponse response = cashfree.post(
                "/pg/orders",
                API_VERSION,
                orderRequest(orderId, amountInr, reference, customerId, phone,
                        ttl.expiryFrom(Instant.now()), notifyUrl),
                OrderResponse.class);

        if (response == null || response.payment_session_id() == null
                || response.payment_session_id().isBlank()) {

            // A 2xx with no session id is a broken vendor contract, not a caller mistake, so it
            // surfaces as a 500. Transport failures never reach here — CashfreeClient.post throws.
            throw new IllegalStateException(
                    "Cashfree returned no payment_session_id for order " + orderId);
        }
        return new PaymentOrder(orderId, response.payment_session_id());
    }

    @Override
    public Optional<String> resumeSession(String orderId) {
        return resumable(cashfree.get("/pg/orders/" + orderId, API_VERSION, OrderResponse.class));
    }

    static Optional<String> resumable(OrderResponse order) {
        if (order == null || !"ACTIVE".equals(order.order_status())
                || order.payment_session_id() == null || order.payment_session_id().isBlank()) {
            return Optional.empty();
        }
        return Optional.of(order.payment_session_id());
    }

    @Override
    public String refund(String orderId, long amountInr, String refundId, String note) {
        String text = note == null || note.isBlank() ? "Refund" : note.strip();
        RefundResponse response = cashfree.post("/pg/orders/" + orderId + "/refunds", API_VERSION,
                Map.of("refund_amount", amountInr, "refund_id", refundId,
                        "refund_note", text.length() > 100 ? text.substring(0, 100) : text),
                RefundResponse.class);
        if (response == null || response.cf_refund_id() == null || response.cf_refund_id().isBlank()) {
            throw new IllegalStateException("Cashfree returned no cf_refund_id for refund " + refundId);
        }
        return response.cf_refund_id();
    }

    record RefundResponse(String cf_refund_id, String refund_id, String refund_status) {
    }

    static Map<String, Object> orderRequest(String orderId, long amountInr, String reference,
            String customerId, String phone, Instant expiresAt, String notifyUrl) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("order_id", orderId);
        body.put("order_amount", amountInr);
        body.put("order_currency", "INR");
        body.put("order_note", reference);
        body.put("order_expiry_time", expiryFormat(expiresAt));
        body.put("customer_details", Map.of(
                "customer_id", customerId,
                "customer_phone", phone));
        if (notifyUrl != null && !notifyUrl.isBlank()) {
            body.put("order_meta", Map.of("notify_url", notifyUrl.trim()));
        }
        return body;
    }

    /** UTC and second-precision because a vendor parser may reject an offset or nanoseconds. */
    private static String expiryFormat(Instant expiresAt) {
        return DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(
                expiresAt.truncatedTo(ChronoUnit.SECONDS).atOffset(ZoneOffset.UTC));
    }

    /** Reduce a {@code reference} to Cashfree's {@code customer_id} charset, stable per buyer. */
    private static String sanitise(String reference) {
        String cleaned = reference == null ? "" : reference.replaceAll("[^A-Za-z0-9_-]", "_");
        return cleaned.isBlank() ? "guest_" + UUID.randomUUID() : cleaned;
    }

    record OrderResponse(String order_id, String payment_session_id, String order_status) {
    }
}
