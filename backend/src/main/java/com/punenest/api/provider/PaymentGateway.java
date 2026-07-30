package com.punenest.api.provider;

import java.util.UUID;
import org.springframework.context.annotation.Profile;
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

/** Dev/default: deterministic fake order, no external call. */
@Component
@Profile("!prod")
class MockPaymentGateway implements PaymentGateway {

    @Override
    public PaymentOrder createOrder(long amountInr, String reference) {
        String orderId = "mock_order_" + UUID.randomUUID();
        return new PaymentOrder(orderId,
                "https://mock.pay.local/checkout/" + orderId + "?amount=" + amountInr);
    }
}

/** Prod stub: fail until Cashfree credentials are wired in. */
@Component
@Profile("prod")
class CashfreePaymentGateway implements PaymentGateway {

    @Override
    public PaymentOrder createOrder(long amountInr, String reference) {
        throw new UnsupportedOperationException("Payment gateway not configured for prod yet");
    }
}
