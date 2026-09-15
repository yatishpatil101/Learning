package com.draazy.api.provider.cashfree;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.provider.PaymentGateway;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Pins what {@code draazy.providers.cashfree.enabled=false} (the default) wires — a property-name
 * typo in {@code @ConditionalOnProperty} would silently unreach the real provider.
 */
@SpringBootTest(properties = "draazy.providers.cashfree.enabled=false")
@DisplayName("Provider wiring — Cashfree disabled (the default)")
class CashfreeProviderDisabledTest {

    @Autowired
    PaymentGateway payments;

    @Autowired(required = false)
    CashfreeClient cashfree;

    @Test
    @DisplayName("wires the mock and does not even construct an HTTP client")
    void wiresMocks() {
        assertThat(payments.getClass().getSimpleName()).isEqualTo("MockPaymentGateway");
        assertThat(cashfree)
                .as("""
                        With the flag off there must be no Cashfree HTTP client bean at all. Absence \
                        is a stronger guarantee than a runtime branch: it means no code path, \
                        deliberate or accidental, can reach the vendor.""")
                .isNull();
    }
}
