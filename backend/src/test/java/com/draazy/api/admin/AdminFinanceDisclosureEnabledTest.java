package com.draazy.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * The other half of {@link AdminFinanceDisclosureTest}: that the disclosures are driven by the
 * {@code draazy.finance.*} properties and not hard-coded to the answer that happens to be right
 * today. Three constants returning {@code false} would satisfy the default test while the
 * properties did nothing at all.
 *
 * <p>A context runner rather than a {@code @SpringBootTest}: the claim is the {@code @Value}
 * binding on {@link AdminFinanceService}, and a full {@code @TestPropertySource} context costs a
 * whole extra application context and Postgres pool for it. The key names themselves are pinned
 * against the deployed properties file by {@link AdminFinancePropertyContractTest}.
 *
 * <p>{@code refunds} stays zero when a flag is on: these are disclosures, not switches, and cannot
 * conjure movements that were never written.
 */
@DisplayName("/admin/finance — the disclosures are configuration, not constants")
class AdminFinanceDisclosureEnabledTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withBean(AdminMetricsRepository.class, () -> mock(AdminMetricsRepository.class))
            .withBean(AdminFinanceService.class);

    @Test
    void settingThePropertiesFlipsEveryDisclosureWithoutInventingMoney() {
        runner.withPropertyValues(
                        "draazy.finance.refunds-measured=true",
                        "draazy.finance.service-orders-counted=true")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    AdminFinance finance = context.getBean(AdminFinanceService.class).finance();
                    assertThat(finance.refundsMeasured()).isTrue();
                    assertThat(finance.serviceOrdersCounted()).isTrue();
                    assertThat(finance.refunds()).isZero();
                });
    }
}