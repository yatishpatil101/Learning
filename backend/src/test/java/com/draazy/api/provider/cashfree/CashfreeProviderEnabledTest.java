package com.draazy.api.provider.cashfree;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.provider.PaymentGateway;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * The flag-on half of {@link CashfreeProviderDisabledTest}. The base URL points at {@code localhost:1}
 * so a wiring mistake surfaces as a connection failure, never as a real Cashfree call from CI.
 */
@SpringBootTest(properties = {
        "draazy.providers.cashfree.enabled=true",
        "draazy.providers.cashfree.base-url=http://localhost:1",
        "draazy.providers.cashfree.app-id=test-app-id",
        "draazy.providers.cashfree.secret-key=test-secret-key"
})
@DisplayName("Provider wiring — Cashfree enabled")
class CashfreeProviderEnabledTest {

    @Autowired
    PaymentGateway payments;

    @Autowired
    CashfreeClient cashfree;

    @Test
    @DisplayName("constructs the Cashfree HTTP client")
    void wiresClient() {
        assertThat(cashfree).isNotNull();
    }

    @Test
    @DisplayName("the payment rail makes a real Cashfree call rather than faking a payment")
    void paymentRailCallsCashfree() {
        // Base URL is an unreachable port on purpose — a createOrder attempt must surface as a
        // Cashfree transport failure, not a mock id CI would treat as settled.
        assertThat(payments.getClass().getSimpleName()).isEqualTo("CashfreePaymentGateway");
        assertThatThrownBy(() -> payments.createOrder(17_000L, "ref"))
                .isInstanceOf(CashfreeClient.CashfreeException.class);
    }
}
