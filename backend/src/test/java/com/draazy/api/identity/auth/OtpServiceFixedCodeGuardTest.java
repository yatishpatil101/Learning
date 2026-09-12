package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import com.draazy.api.provider.OtpSender;
import com.draazy.api.security.LocalProfileGuard;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.core.env.Environment;
import org.springframework.mock.env.MockEnvironment;

/**
 * Covers the route the properties pins cannot: an exported env var outranks a classpath config file,
 * leaving only these boot guards. Reasoning: docs/flows/consumer/auth.md.
 */
@DisplayName("The predictable-login-code guards — the ones that survive an environment variable")
class OtpServiceFixedCodeGuardTest {

    @ParameterizedTest(name = "the ''{0}'' profile refuses to boot with a fixed code")
    @ValueSource(strings = {"prod", "sandbox"})
    void everyDeploymentProfileRefusesAPredictableLoginCode(String profile) {
        assertThatThrownBy(() -> guardUnder("000000", profile))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("draazy.otp.fixed-code is set")
                .hasMessageContaining("'" + profile + "' profile is active")
                // The misconfiguration is somewhere other than the file a reader checks first.
                .hasMessageContaining("DRAAZY_OTP_FIXED_CODE")
                .hasMessageContaining("E2E_OTP_CODE");
    }

    @Test
    @DisplayName("the guarded list is exactly the shared definition, not a copy")
    void theProfilesCoveredAreTheOnesTheRestOfTheAppCallsDeployments() {
        // A hand-copied profile list cannot produce this failure when DEPLOYMENT_PROFILES grows.
        org.assertj.core.api.Assertions.assertThat(LocalProfileGuard.DEPLOYMENT_PROFILES)
                .as("add the new profile to the @ValueSource above, then delete this line's surprise")
                .containsExactly("prod", "sandbox");
    }

    @Test
    void aDeveloperMachineMayStillUseAFixedCode() {
        // Without the fixed code every Playwright login has to scrape the backend log, which
        // forces the suite serial.
        assertThatCode(() -> guardUnder("000000", "local", "e2e")).doesNotThrowAnyException();
    }

    @Test
    void anUnsetCodeIsNeverAFinding() {
        // The common deployment case, pinned so a future tightening cannot fail every real boot.
        assertThatCode(() -> guardUnder("", "prod")).doesNotThrowAnyException();
        assertThatCode(() -> guardUnder("   ", "sandbox"))
                .as("whitespace is trimmed to empty, so it is not a usable code either")
                .doesNotThrowAnyException();
    }

    @ParameterizedTest(name = "the ''{0}'' profile refuses to boot with a sandbox code")
    @ValueSource(strings = {"prod", "local", "e2e", "sandbx"})
    void onlySandboxItselfMayCarryTheSandboxCode(String profile) {
        // "sandbx" is deliberate: the guard asks whether sandbox is active, so a typo in
        // SPRING_PROFILES_ACTIVE must fail the boot rather than hand out a shared login.
        assertThatThrownBy(() -> sandboxGuardUnder("000000", profile))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("draazy.otp.sandbox-code is set")
                .hasMessageContaining("DRAAZY_OTP_SANDBOX_CODE");
    }

    @Test
    @DisplayName("sandbox itself boots with it, which is the entire point of the second key")
    void sandboxMayCarryTheCodeNamedAfterIt() {
        assertThatCode(() -> sandboxGuardUnder("000000", "sandbox")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a superset activation is not sandbox: `prod,sandbox` is refused")
    void aSupersetActivationIsRefused() {
        // A realistic copy-paste: allowing it would pair the production datasource and secrets with
        // one shared login code, through the one key that is permitted to be set.
        assertThatThrownBy(() -> sandboxGuardUnder("000000", "prod", "sandbox"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("'prod' is also active");
        assertThatThrownBy(() -> sandboxGuardUnder("000000", "sandbox", "prod"))
                .as("profile order must not decide this")
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void anUnsetSandboxCodeIsNeverAFinding() {
        assertThatCode(() -> sandboxGuardUnder("", "prod")).doesNotThrowAnyException();
        assertThatCode(() -> sandboxGuardUnder("   ", "prod"))
                .as("whitespace is trimmed to empty, so it is not a usable code either")
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("an attempt cap that would lock the environment out, or stop defending it, is refused")
    void anUnusableAttemptCapIsRefused() {
        // Both ends, because the guard is an interval and an inverted comparison passes one bound
        // on its own.
        assertThatThrownBy(() -> capGuardAt(0)).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("max-verify-attempts");
        assertThatThrownBy(() -> capGuardAt(21)).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("max-verify-attempts");
    }

    @Test
    @DisplayName("the usable extremes boot, so the guard cannot pass by refusing everything")
    void theBoundsThemselvesAreAllowed() {
        assertThatCode(() -> capGuardAt(1)).doesNotThrowAnyException();
        assertThatCode(() -> capGuardAt(20)).doesNotThrowAnyException();
        assertThatCode(() -> capGuardAt(OtpService.DEFAULT_MAX_VERIFY_ATTEMPTS))
                .as("the shipped default must be inside the interval its own guard enforces")
                .doesNotThrowAnyException();
    }

    /** Builds the service with mocked collaborators and runs only the {@code @PostConstruct} check. */
    private static void guardUnder(String fixedCode, String... profiles) {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(profiles);
        service(environment, fixedCode, "").rejectFixedCodeInProduction();
    }

    /** The same, for the sibling key that sandbox gets in place of an exemption. */
    private static void sandboxGuardUnder(String sandboxCode, String... profiles) {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(profiles);
        service(environment, "", sandboxCode).rejectSandboxCodeOutsideSandbox();
    }

    /** The same again, for the cap. No profile decides this one — an unusable cap is unusable. */
    private static void capGuardAt(int maxVerifyAttempts) {
        new OtpService(mock(OtpCodeRepository.class), mock(OtpSender.class),
                mock(OtpSendBudget.class), new MockEnvironment(), "", "", maxVerifyAttempts)
                .rejectUnusableAttemptCap();
    }

    private static OtpService service(
            Environment environment, String fixedCode, String sandboxCode) {
        return new OtpService(
                mock(OtpCodeRepository.class),
                mock(OtpSender.class),
                // Mocked: these guards run at boot and never send, so real tuning would read as
                // part of what is proved.
                mock(OtpSendBudget.class),
                environment,
                fixedCode,
                sandboxCode,
                OtpService.DEFAULT_MAX_VERIFY_ATTEMPTS);
    }
}
