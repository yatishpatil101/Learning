package com.punenest.api.provider;

import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Seam for the payment gateway (Cashfree per the contract's webhooks). Amounts are whole INR
 * (platform money convention). Dev returns a deterministic order so the pay flow is demoable
 * without a merchant account.
 */
public interface PaymentGateway {

    /**
     * Create a payment order for {@code amountInr} rupees against a caller {@code reference}.
     *
     * @return the gateway order id + a redirect URL to complete payment
     */
    PaymentOrder createOrder(long amountInr, String reference);

    /** A created payment order. */
    record PaymentOrder(String orderId, String redirectUrl) {
    }
}

/**
 * Default: deterministic fake order, no external call. See {@link
 * com.punenest.api.provider.cashfree.CashfreeProperties} for why the switch is a credentials flag
 * rather than the {@code prod} profile.
 */
@Component
@ConditionalOnProperty(prefix = "punenest.providers.cashfree", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class MockPaymentGateway implements PaymentGateway {

    @Override
    public PaymentOrder createOrder(long amountInr, String reference) {
        String orderId = "mock_order_" + UUID.randomUUID();
        return new PaymentOrder(orderId,
                "https://mock.pay.local/checkout/" + orderId + "?amount=" + amountInr);
    }
}

/**
 * Placeholder for the real Cashfree rail, which lands in slice 6.
 *
 * <p><strong>Why this is still a stub while {@code CashfreeKycProvider} is real.</strong> KYC has a
 * live consumer today — {@code VerificationService} calls it on every Aadhaar badge request — so the
 * real implementation is exercised the moment the flag flips. This interface has <em>no consumer at
 * all</em>: nothing in the codebase calls {@code createOrder}. Writing an HTTP client for it now would
 * add a few hundred lines that no test can meaningfully cover and no caller can shape.
 *
 * <p>And it would very likely be wrong. {@link PaymentOrder#redirectUrl()} assumes a hosted-checkout
 * handoff, but Cashfree's current Payment Gateway API does not issue one: {@code POST /pg/orders}
 * returns a {@code payment_session_id} for the JS SDK to consume, while a URL you can send someone
 * comes from Payment <em>Links</em> ({@code POST /pg/links} → {@code link_url}) — a different product
 * with different semantics. Which of the two fits rent collection is a product decision slice 6 has to
 * make with the frontend in front of it; guessing now means writing the client twice and probably
 * changing this record's shape anyway.
 *
 * <p>So the seam stays declared and the mock stays usable. Failing loudly here is the honest
 * behaviour: it is better than a silent mock payment in an environment that was configured, by
 * someone setting the flag, to expect real money to move.
 */
@Component
@ConditionalOnProperty(prefix = "punenest.providers.cashfree", name = "enabled", havingValue = "true")
class CashfreePaymentGateway implements PaymentGateway {

    @Override
    public PaymentOrder createOrder(long amountInr, String reference) {
        throw new UnsupportedOperationException(
                "The Cashfree payment rail is not implemented yet (slice 6). "
                        + "Set punenest.providers.cashfree.enabled=false to use the mock gateway.");
    }
}
