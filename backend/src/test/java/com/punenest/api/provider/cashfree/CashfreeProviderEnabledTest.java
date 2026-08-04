package com.punenest.api.provider.cashfree;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.punenest.api.provider.KycProvider;
import com.punenest.api.provider.PaymentGateway;
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
        "punenest.providers.cashfree.enabled=true",
        "punenest.providers.cashfree.base-url=http://localhost:1",
        "punenest.providers.cashfree.app-id=test-app-id",
        "punenest.providers.cashfree.secret-key=test-secret-key"
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
    @DisplayName("the payment rail refuses loudly rather than silently faking a payment")
    void paymentRailIsHonestlyUnimplemented() {
        // Slice 6 owns the real rail. Until then, an environment configured by someone who set the
        // flag — i.e. one expecting real money to move — must not receive a mock order id that it
        // would happily go on to treat as a settled payment.
        assertThat(payments.getClass().getSimpleName()).isEqualTo("CashfreePaymentGateway");
        assertThatThrownBy(() -> payments.createOrder(17_000L, "ref"))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("slice 6");
    }
}
