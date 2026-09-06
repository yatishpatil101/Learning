package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import com.draazy.api.common.persistence.RateLimitLock;
import com.draazy.api.provider.OtpSender;
import com.draazy.api.security.LocalProfileGuard;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.core.env.Environment;
import org.springframework.mock.env.MockEnvironment;

/**
 * The third of the three guards on {@code draazy.otp.fixed-code}, tested on its own.
 *
 * <p>The other two are properties pins — {@code application-prod.properties} and
 * {@code application-sandbox.properties} both set the key back to empty — and
 * {@link com.draazy.api.foundation.SandboxProfileContractTest} covers those. This one exists for the
 * route a properties file structurally cannot cover: a classpath config-data file is the
 * <em>lowest</em>-precedence source Spring consults, so {@code DRAAZY_OTP_FIXED_CODE} exported into a
 * deployment's environment silently outranks both pins. At that point the only thing standing
 * between the deployment and a login code every account shares is
 * {@link OtpService#rejectFixedCodeInProduction()}.
 *
 * <p><strong>Why it is a parameterized test over the profile list.</strong> The guard used to read a
 * literal {@code "prod"}. When the sandbox environment stopped being deployed as {@code
 * prod,sandbox} and became a standalone {@code sandbox} profile, that literal stopped matching — and
 * nothing failed. Both properties files still pinned the code to empty, so every existing test
 * passed while the guard was disarmed on the one internet-facing environment that is not production.
 * Driving this from {@link LocalProfileGuard#DEPLOYMENT_PROFILES} means a fifth environment added
 * later is covered on the day it is named, rather than on the day someone remembers this file.
 */
@DisplayName("The fixed-OTP-code guard — the one that survives an environment variable")
class OtpServiceFixedCodeGuardTest {

    @ParameterizedTest(name = "the ''{0}'' profile refuses to boot with a fixed code")
    @ValueSource(strings = {"prod", "sandbox"})
    void everyDeploymentProfileRefusesAPredictableLoginCode(String profile) {
        assertThatThrownBy(() -> guardUnder("000000", profile))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("draazy.otp.fixed-code is set")
                .hasMessageContaining("'" + profile + "' profile is active")
                // The variable names matter: the misconfiguration is somewhere other than the file
                // whoever reads this message will go and check first.
                .hasMessageContaining("DRAAZY_OTP_FIXED_CODE")
                .hasMessageContaining("E2E_OTP_CODE");
    }

    @Test
    @DisplayName("the guarded list is exactly the shared definition, not a copy")
    void theProfilesCoveredAreTheOnesTheRestOfTheAppCallsDeployments() {
        // If DEPLOYMENT_PROFILES grows, the @ValueSource above is now incomplete and this fails —
        // which is the failure that did not happen when `sandbox` was introduced.
        org.assertj.core.api.Assertions.assertThat(LocalProfileGuard.DEPLOYMENT_PROFILES)
                .as("add the new profile to the @ValueSource above, then delete this line's surprise")
                .containsExactly("prod", "sandbox");
    }

    @Test
    void aDeveloperMachineMayStillUseAFixedCode() {
        // The local and e2e profiles are the entire reason the property exists: without it every
        // Playwright login has to scrape the backend log, which forces the suite serial.
        assertThatCode(() -> guardUnder("000000", "local", "e2e")).doesNotThrowAnyException();
    }

    @Test
    void anUnsetCodeIsNeverAFinding() {
        // The overwhelmingly common deployment case. Asserted so a future tightening of the guard
        // cannot start failing every real boot.
        assertThatCode(() -> guardUnder("", "prod")).doesNotThrowAnyException();
        assertThatCode(() -> guardUnder("   ", "sandbox"))
                .as("whitespace is trimmed to empty, so it is not a usable code either")
                .doesNotThrowAnyException();
    }

    /** Builds the service with mocked collaborators and runs only the {@code @PostConstruct} check. */
    private static void guardUnder(String fixedCode, String... profiles) {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(profiles);
        service(environment, fixedCode).rejectFixedCodeInProduction();
    }

    private static OtpService service(Environment environment, String fixedCode) {
        return new OtpService(
                mock(OtpCodeRepository.class),
                mock(OtpSender.class),
                mock(RateLimitLock.class),
                environment,
                60L,
                5,
                fixedCode);
    }
}
