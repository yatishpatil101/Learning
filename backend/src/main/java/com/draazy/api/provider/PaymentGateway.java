package com.draazy.api.provider;

import com.draazy.api.common.payments.CheckoutTtl;
import com.draazy.api.provider.cashfree.CashfreeClient;
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
 * Seam for the payment gateway (Cashfree per the contract's webhooks). Amounts are whole INR
 * (platform money convention). Dev returns a deterministic order so the pay flow is demoable
 * without a merchant account.
 *
 * <p><strong>Option A — hosted checkout.</strong> {@link PaymentOrder} carries a {@code
 * paymentSessionId}, not a redirect URL: Cashfree's Payment Gateway ({@code POST /pg/orders}) hands
 * back a single-use session id that the browser's {@code @cashfreepayments/cashfree-js} SDK consumes
 * via {@code cashfree.checkout(...)}. The session id is ephemeral and is returned to the client once,
 * at order time — it is never persisted. The {@code orderId} is the durable handle the webhook uses
 * to find the row again.
 */
public interface PaymentGateway {

    /**
     * Create a payment order with no buyer context — the caller has none to give (boosts, rent).
     *
     * <p>Cashfree still needs a {@code customer_details} block, so the implementation derives a
     * stable id from {@code reference} and falls back to a placeholder phone. Flows that hold the
     * buyer's identity should call {@link #createOrder(long, String, Customer)} instead so Cashfree
     * can prefill and notify the real payer.
     */
    default PaymentOrder createOrder(long amountInr, String reference) {
        return createOrder(amountInr, reference, null);
    }

    /**
     * Create a payment order for {@code amountInr} rupees against a caller {@code reference}, with an
     * optional {@code customer} so Cashfree can prefill and notify the payer.
     *
     * @return the gateway order id + the single-use payment session id for the checkout SDK
     */
    PaymentOrder createOrder(long amountInr, String reference, Customer customer);

    /** A created payment order. {@code paymentSessionId} is single-use and must not be stored. */
    record PaymentOrder(String orderId, String paymentSessionId) {
    }

    /**
     * The buyer, for Cashfree's {@code customer_details}. {@code phone} may be null — the
     * implementation substitutes a placeholder rather than fail, since the payer authenticates with
     * their own instrument at the hosted checkout regardless.
     */
    record Customer(String id, String phone) {
    }
}

/**
 * Default: deterministic fake order, no external call. See {@link
 * com.draazy.api.provider.cashfree.CashfreeProperties} for why the switch is a credentials flag
 * rather than the {@code prod} profile.
 */
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
 * The real Cashfree Payment Gateway rail (Option A, hosted checkout).
 *
 * <p>Only wired when {@code draazy.providers.cashfree.enabled=true}; otherwise
 * {@link MockPaymentGateway} stands in and the pay flow is fully demoable with no merchant account.
 * All calls go through {@link CashfreeClient}, which owns the credentials, timeouts and the
 * "never let a vendor error string reach a user" rule.
 *
 * <p><strong>The order id is ours, not Cashfree's.</strong> We send {@code order_id} rather than let
 * Cashfree mint one, because it is echoed back on the {@code PAYMENT_SUCCESS} webhook and is the only
 * thing tying that callback to the subscription / rent / boost row that opened it. A UUID prefix
 * keeps it inside Cashfree's {@code [A-Za-z0-9_-]} charset.
 *
 * <p><strong>{@code payment_session_id} is single-use.</strong> It is returned to the browser once,
 * for {@code cashfree.checkout(...)}, and never stored — a stale session id is worthless, and a
 * stored one is a needless secret at rest.
 *
 * <p><strong>The order stops being payable when our row stops existing</strong> (D169). Every order
 * carries an {@code order_expiry_time} taken from {@link CheckoutTtl}, the same object
 * {@code AbandonedCheckoutSweep} subtracts to decide a row has been abandoned. Without it a
 * Cashfree order outlived the 45-minute TTL by weeks: the sweep retired our side while the customer
 * could still pay the other, and the money landed on a row that had already moved on — for rent a
 * literal double charge, because retiring the row frees the month for a second one. The two windows
 * are now the same window.
 */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.cashfree", name = "enabled", havingValue = "true")
class CashfreePaymentGateway implements PaymentGateway {

    /** The Payment Gateway product is versioned separately from Secure ID (KYC). */
    private static final String API_VERSION = "2025-01-01";

    /**
     * Cashfree requires a phone on every order. When the caller has none (boosts, rent), this stands
     * in: the payer still enters their own instrument at checkout, so it only affects prefill. A
     * documented placeholder is more honest than inventing a number that could reach a real handset.
     */
    private static final String PLACEHOLDER_PHONE = "9999999999";

    private final CashfreeClient cashfree;
    private final CheckoutTtl ttl;

    CashfreePaymentGateway(CashfreeClient cashfree, CheckoutTtl ttl) {
        this.cashfree = cashfree;
        this.ttl = ttl;
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
                        ttl.expiryFrom(Instant.now())),
                OrderResponse.class);

        if (response == null || response.payment_session_id() == null
                || response.payment_session_id().isBlank()) {
            // A 2xx with no session id is a broken vendor contract, not a caller mistake: surface
            // it as a 500 (via the generic handler) rather than blame the user for a malformed
            // reply. Transport failures never reach here - CashfreeClient.post throws first.
            throw new IllegalStateException(
                    "Cashfree returned no payment_session_id for order " + orderId);
        }
        return new PaymentOrder(orderId, response.payment_session_id());
    }

    /**
     * The {@code POST /pg/orders} body, assembled apart from the call so it can be asserted without
     * a merchant account or a live socket — {@code order_expiry_time} is the one field here whose
     * absence is invisible until real money is at stake.
     *
     * <p>A {@link LinkedHashMap} rather than {@code Map.of} so the serialized body reads in a fixed
     * order when it is logged or diffed; nulls never reach it, so the null-hostility of {@code
     * Map.of} is not what was buying anything.
     */
    static Map<String, Object> orderRequest(String orderId, long amountInr, String reference,
            String customerId, String phone, Instant expiresAt) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("order_id", orderId);
        body.put("order_amount", amountInr);
        body.put("order_currency", "INR");
        body.put("order_note", reference);
        body.put("order_expiry_time", expiryFormat(expiresAt));
        body.put("customer_details", Map.of(
                "customer_id", customerId,
                "customer_phone", phone));
        return body;
    }

    /**
     * Cashfree's expiry format: ISO-8601 with an explicit offset, seconds precision.
     *
     * <p>UTC rather than IST, and truncated rather than left with nanoseconds, because both are
     * things a vendor parser is entitled to reject and neither carries information anybody needs —
     * the instant is the same instant either way.
     */
    private static String expiryFormat(Instant expiresAt) {
        return DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(
                expiresAt.truncatedTo(ChronoUnit.SECONDS).atOffset(ZoneOffset.UTC));
    }

    /** Reduce a {@code reference} to Cashfree's {@code customer_id} charset, stable per buyer. */
    private static String sanitise(String reference) {
        String cleaned = reference == null ? "" : reference.replaceAll("[^A-Za-z0-9_-]", "_");
        return cleaned.isBlank() ? "guest_" + UUID.randomUUID() : cleaned;
    }

    /**
     * The subset of Cashfree's reply we use. Unknown fields are ignored by Jackson's default
     * behaviour on records, so the vendor adding one does not break the boot.
     */
    record OrderResponse(String order_id, String payment_session_id, String order_status) {
    }
}
