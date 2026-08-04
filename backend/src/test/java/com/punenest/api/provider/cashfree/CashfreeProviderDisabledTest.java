package com.punenest.api.provider.cashfree;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.provider.KycProvider;
import com.punenest.api.provider.PaymentGateway;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Pins what {@code punenest.providers.cashfree.enabled=false} — the default — actually wires.
 *
 * <p><strong>Why this is worth a test.</strong> The flag decides whether a user's Aadhaar details
 * leave the building, and it does so through conditional bean wiring: the kind of configuration that
 * fails silently and in the wrong direction. A typo in the property name inside
 * {@code @ConditionalOnProperty} does not fail the boot — it just makes {@code matchIfMissing}
 * permanently true, so the real provider becomes unreachable no matter how the environment is
 * configured, and nobody notices until a KYC that appeared to succeed turns out never to have been
 * sent. Asserting on the concrete class is the only way to see which implementation is live.
 *
 * @see CashfreeProviderEnabledTest for the flag-on half
 */
@SpringBootTest(properties = "punenest.providers.cashfree.enabled=false")
@DisplayName("Provider wiring — Cashfree disabled (the default)")
class CashfreeProviderDisabledTest {

    @Autowired
    KycProvider kyc;

    @Autowired
    PaymentGateway payments;

    @Autowired(required = false)
    CashfreeClient cashfree;

    @Test
    @DisplayName("wires the mocks and does not even construct an HTTP client")
    void wiresMocks() {
        assertThat(kyc.getClass().getSimpleName()).isEqualTo("MockKycProvider");
        assertThat(payments.getClass().getSimpleName()).isEqualTo("MockPaymentGateway");
        assertThat(cashfree)
                .as("""
                        With the flag off there must be no Cashfree HTTP client bean at all. Absence \
                        is a stronger guarantee than a runtime branch: it means no code path, \
                        deliberate or accidental, can reach the vendor.""")
                .isNull();
    }

    @Test
    @DisplayName("the mock KYC session is self-consistent and points nowhere real")
    void mockSessionIsUsable() {
        KycProvider.KycSession session = kyc.start("user-1");
        assertThat(session.ref()).startsWith("mock_kyc_");
        assertThat(session.verificationUrl()).contains(session.ref()).doesNotContain("cashfree");
        assertThat(session.expiresAt()).isAfter(Instant.now());
    }
}
