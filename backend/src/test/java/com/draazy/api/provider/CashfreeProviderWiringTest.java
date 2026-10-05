package com.draazy.api.provider;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.payments.CheckoutTtl;
import com.draazy.api.provider.cashfree.CashfreeClient;
import com.draazy.api.provider.cashfree.CashfreeProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Pins what {@code draazy.providers.cashfree.enabled} wires — a property-name typo in
 * {@code @ConditionalOnProperty} would silently unreach the real provider. The enabled base URL
 * points at {@code localhost:1} so a wiring mistake surfaces as a connection failure, never as a
 * real Cashfree call from CI.
 */
@DisplayName("Provider wiring — Cashfree")
class CashfreeProviderWiringTest {

    @Configuration
    @EnableConfigurationProperties(CashfreeProperties.class)
    static class Wiring {
        @Bean
        CheckoutTtl checkoutTtl() {
            return new CheckoutTtl(45);
        }
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(Wiring.class, MockPaymentGateway.class,
                    CashfreePaymentGateway.class, CashfreeClient.class);

    @ParameterizedTest(name = "{0} wires the mock and does not even construct an HTTP client")
    @ValueSource(strings = {"draazy.providers.cashfree.enabled=false", "unset=true"})
    @DisplayName("flag off (explicit or the default) wires the mock and no HTTP client")
    void wiresMocks(String property) {
        runner.withPropertyValues(property).run(context -> {
            assertThat(context.getBean(PaymentGateway.class)).isInstanceOf(MockPaymentGateway.class);
            assertThat(context).doesNotHaveBean(CashfreeClient.class);
            assertThat(context).doesNotHaveBean(CashfreePaymentGateway.class);
        });
    }

    @Test
    @DisplayName("the payment rail makes a real Cashfree call rather than faking a payment")
    void paymentRailCallsCashfree() {
        runner.withPropertyValues(
                        "draazy.providers.cashfree.enabled=true",
                        "draazy.providers.cashfree.base-url=http://localhost:1",
                        "draazy.providers.cashfree.app-id=test-app-id",
                        "draazy.providers.cashfree.secret-key=test-secret-key")
                .run(context -> {
                    PaymentGateway payments = context.getBean(PaymentGateway.class);
                    assertThat(payments).isInstanceOf(CashfreePaymentGateway.class);
                    assertThat(context).hasSingleBean(CashfreeClient.class);
                    assertThatThrownBy(() -> payments.createOrder(17_000L, "ref"))
                            .isInstanceOf(CashfreeClient.CashfreeException.class);
                });
    }
}
