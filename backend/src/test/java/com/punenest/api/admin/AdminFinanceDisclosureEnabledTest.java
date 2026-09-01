package com.punenest.api.admin;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.TestPropertySource;

/**
 * The other half of {@link AdminFinanceDisclosureTest}: that the disclosures are genuinely driven
 * by configuration and not hard-coded to the answer that happens to be right today.
 *
 * <p>This is the assertion that makes the D63/D65 deferral honest. The promise made to whoever
 * ships the payout slice is "set the property, the screen stops apologising, no code change" — and
 * a promise about a property name is worth exactly as much as the test that spells it. Without this
 * class, three constants returning {@code false} would satisfy the default test perfectly while the
 * properties did nothing at all, and nobody would find out until the day someone tried to turn one
 * on.
 *
 * <p>A separate class because {@code @TestPropertySource} keys a distinct application context;
 * Spring caches both, so the second context is built once for the suite rather than per test. The
 * precedent is {@code CashfreeProviderDisabledTest} / {@code CashfreeProviderEnabledTest}, which
 * split the same way. <strong>Counting contexts:</strong>
 * {@code src/test/resources/application.properties} records that the fourth context to appear once
 * exhausted the local Postgres {@code max_connections}; this is the sixth, at
 * {@code maximum-pool-size=4}. If the suite ever trips that ceiling again, the cheap collapse here
 * is to fold this class back into {@link AdminFinanceDisclosureTest} and assert the enabled half by
 * constructing {@link AdminFinanceService} directly, as {@code AdminMetricsServiceCacheTest} does
 * for the analytics half.
 *
 * <p><strong>What flipping a flag does not do.</strong> {@code refunds} is
 * still zero here, and correctly: these are disclosures, not switches. Turning one on says "the
 * path exists now, believe the number" — it cannot conjure movements that were never written. On
 * a fresh test database the honest answer above a real refund path is still zero, and that is what
 * this asserts.
 */
@DisplayName("/admin/finance — the disclosures are configuration, not constants")
@TestPropertySource(properties = {
    "punenest.finance.refunds-measured=true",
    "punenest.finance.service-orders-counted=true"
})
class AdminFinanceDisclosureEnabledTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String admin() {
        User u = new User("9877710002", Roles.Wire.ADMIN);
        u.setName("Disclosure admin on");
        u.setMobileVerified(true);
        return bearer(users.saveAndFlush(u));
    }

    @Test
    void settingThePropertiesFlipsEveryDisclosure() throws Exception {
        mvc.perform(get(Routes.Admin.FINANCE).header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.refundsMeasured").value(true))
                .andExpect(jsonPath("$.serviceOrdersCounted").value(true));
    }

    @Test
    void aDisclosureDoesNotInventMoney() throws Exception {
        mvc.perform(get(Routes.Admin.FINANCE).header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.refunds").value(0));
    }
}
