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

/**
 * The default half of the D63/D65 disclosure contract: with no configuration at all,
 * {@code /admin/finance} must admit that two of its four money figures are not measured and that
 * revenue excludes the services marketplace.
 *
 * <p><strong>Why this needs a test when the values are literals.</strong> The zeros are not what is
 * under test — {@link AdminMetricsEndpointsTest} already pins those. What is under test is that the
 * <em>default</em> is today's truth. A disclosure that defaults to "measured" is worse than no
 * disclosure at all: it is an affirmative claim that a figure means something, made by a system
 * that has no way to produce that figure, and it is exactly the failure a missing default or a
 * typo'd property name would produce silently. The flags read from
 * {@code punenest.finance.*} with a {@code :false} fallback baked into the {@code @Value}.
 *
 * <p><strong>What this class does not cover.</strong> Only that fallback.
 * {@code src/test/resources/application.properties} shadows the main file rather than merging with
 * it, so this context never loads {@code src/main/resources/application.properties} and cannot show
 * that its keys are spelled the way the annotations read them — a singular
 * {@code punenest.finance.payout-measured} in the deployed file would leave this test green and the
 * {@code FINANCE_PAYOUTS_MEASURED} override inert. That link is pinned by
 * {@link AdminFinancePropertyContractTest}, which reads both artefacts off disk.
 *
 * <p>The other half — that setting the properties actually flips the response — is
 * {@link AdminFinanceDisclosureEnabledTest}, which has to be a separate class because
 * {@code @TestPropertySource} builds a separate application context.
 */
@DisplayName("/admin/finance — structural zeros disclose themselves by default")
class AdminFinanceDisclosureTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String admin() {
        User u = new User("9877710001", Roles.Wire.ADMIN);
        u.setName("Disclosure admin");
        u.setMobileVerified(true);
        return bearer(users.saveAndFlush(u));
    }

    /**
     * The defaults are the ones that describe the platform as it is today: no payout has ever been
     * executed, no refund path exists, and {@code service_orders.amount} is a quote rather than a
     * receipt. Every flag false, and therefore every figure beside one marked as a structural zero.
     */
    @Test
    void noPathHasShippedSoNothingClaimsToBeMeasured() throws Exception {
        mvc.perform(get(Routes.Admin.FINANCE).header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payoutsMeasured").value(false))
                .andExpect(jsonPath("$.refundsMeasured").value(false))
                .andExpect(jsonPath("$.serviceOrdersCounted").value(false));
    }

    /**
     * The disclosure travels <em>with</em> the figure, not instead of it. Omitting a number the
     * screen has a slot for is how a rendering bug and an absent money path become the same blank
     * cell, so both zeros stay in the payload and the flag is what tells them apart.
     */
    @Test
    void theDisclosedFiguresAreStillReportedAsZeroNotDropped() throws Exception {
        mvc.perform(get(Routes.Admin.FINANCE).header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payoutsCompleted").value(0))
                .andExpect(jsonPath("$.refunds").value(0));
    }

    /**
     * {@code serviceOrdersCounted} is false and the breakdown is the proof: no {@code services}
     * line appears in it. Deliberately not asserting the row count — the number of revenue sources
     * is {@link AdminMetricsEndpointsTest}'s business, and pinning it here would break this
     * disclosure test the day a legitimate fourth non-services source ships.
     */
    @Test
    void revenueDrawsFromSourcesThatDoNotIncludeServices() throws Exception {
        mvc.perform(get(Routes.Admin.FINANCE).header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.breakdown[?(@.source == 'services')]").doesNotExist());
    }
}
