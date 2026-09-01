package com.draazy.api.provider.cashfree;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.provider.KycProvider;
import com.draazy.api.provider.PaymentGateway;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * The flag-on half of {@link CashfreeProviderDisabledTest}: with credentials present, the real
 * Cashfree providers must take over.
 *
 * <p>The base URL points at {@code localhost:1} on purpose. This test asserts <em>wiring</em>, not
 * vendor behaviour, and an unreachable port guarantees that a mistake here surfaces as a connection
 * failure rather than as a real call to Cashfree from someone's CI runner.
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
    KycProvider kyc;

    @Autowired
    PaymentGateway payments;

    @Autowired
    CashfreeClient cashfree;

    @Test
    @DisplayName("swaps in the real Cashfree KYC provider and its HTTP client")
    void wiresRealKyc() {
        assertThat(kyc.getClass().getSimpleName()).isEqualTo("CashfreeKycProvider");
        assertThat(cashfree).isNotNull();
    }

    @Test
    @DisplayName("the payment rail makes a real Cashfree call rather than faking a payment")
    void paymentRailCallsCashfree() {
        // With the flag on and credentials present the real rail is wired. The base URL points at
        // an unreachable port on purpose, so a createOrder attempt surfaces as a Cashfree transport
        // failure - proof it tried to reach the vendor rather than handing back a mock order id an
        // environment expecting real money would treat as settled.
        assertThat(payments.getClass().getSimpleName()).isEqualTo("CashfreePaymentGateway");
        assertThatThrownBy(() -> payments.createOrder(17_000L, "ref"))
                .isInstanceOf(CashfreeClient.CashfreeException.class);
    }
}
