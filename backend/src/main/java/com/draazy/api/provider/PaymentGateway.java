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
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Seam for the payment gateway. Amounts are whole INR, and {@code paymentSessionId} is single-use,
 * so only {@code orderId} is durable enough for the webhook to find the row again.
 */
public interface PaymentGateway {

    /**
     * For callers with no buyer context (boosts, rent). Prefer
     * {@link #createOrder(long, String, Customer)} so Cashfree can prefill and notify the real payer.
     */
    default PaymentOrder createOrder(long amountInr, String reference) {
        return createOrder(amountInr, reference, null);
    }

    /**
     * @return the gateway order id + the single-use payment session id for the checkout SDK
     */
    PaymentOrder createOrder(long amountInr, String reference, Customer customer);

    /** A created payment order. {@code paymentSessionId} is single-use and must not be stored. */
    record PaymentOrder(String orderId, String paymentSessionId) {
    }

    /** {@code phone} may be null — the payer authenticates with their own instrument regardless. */
    record Customer(String id, String phone) {
    }
}

/** Deterministic fake order, no external call, so the pay flow demos without a merchant account. */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.cashfree", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class MockPaymentGateway implements PaymentGateway {

    @Override
    public PaymentOrder createOrder(long amountInr, String reference, Customer customer) {
        String orderId = "mock_order_" + UUID.randomUUID();
        return new PaymentOrder(orderId, "mock_session_" + UUID.randomUUID());
    }
}

/**
 * The real Cashfree rail. The order id is ours because it is echoed on the webhook and is the only
 * link back to the row; its expiry is {@link CheckoutTtl} so the vendor cannot outlive our sweep.
 */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.cashfree", name = "enabled", havingValue = "true")
class CashfreePaymentGateway implements PaymentGateway {

    /** The Payment Gateway product is versioned separately from Secure ID (KYC). */
    private static final String API_VERSION = "2025-01-01";

    /** Only affects prefill; a documented placeholder beats inventing a reachable number. */
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

    /**
     * Cashfree POSTs the phone, amount and HMAC here, so a typo'd {@code http://} would put all of
     * it in cleartext. A typo'd <em>host</em> is not catchable — the right one differs per env.
     */
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

    /**
     * Assembled apart from the call so it can be asserted without a merchant account. {@code
     * notify_url} is omitted when blank: absent means "use the dashboard", empty is rejectable.
     */
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

    /** Unknown fields are ignored, so the vendor adding one does not break the boot. */
    record OrderResponse(String order_id, String payment_session_id, String order_status) {
    }
}
