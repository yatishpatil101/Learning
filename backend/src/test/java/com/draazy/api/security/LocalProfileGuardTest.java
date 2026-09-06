package com.draazy.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

/**
 * The {@code local} profile is a claim; {@code DRAAZY_DEV_MACHINE} is the evidence.
 *
 * <p>These tests exist because the control they cover is one that nobody exercises deliberately —
 * it only ever fires on a machine where something has already gone wrong, so a regression in it is
 * invisible until the day it matters. The two that carry the most weight are
 * {@link #aPropertyEntryCannotStandInForTheEnvironmentVariable()}, which pins the reason this is
 * {@code System.getenv} and not {@code Environment.getProperty}, and
 * {@link #theBuildsOwnTestRunIsExempt_whichIsWhatKeepsTheSuiteGreen()}, which pins the one exemption
 * and would otherwise be discovered by ~880 unrelated failures.
 */
class LocalProfileGuardTest {

    private static final LocalProfileGuard.OsEnvironment UNSET = name -> null;
    private static final LocalProfileGuard.OsEnvironment ATTESTED = name ->
            LocalProfileGuard.DEV_MACHINE_VARIABLE.equals(name) ? "1" : null;

    @Test
    void localProfileOnAnAttestedMachineStartsNormally() {
        assertThatCode(() -> LocalProfileGuard.assertDevMachineAttested(profiles("local"), ATTESTED, false))
                .doesNotThrowAnyException();
    }

    @Test
    void localProfileWithoutTheVariableRefusesToStart() {
        assertThatThrownBy(() -> LocalProfileGuard.assertDevMachineAttested(profiles("local"), UNSET, false))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage(LocalProfileGuard.missingAttestationMessage());
    }

    @Test
    void theFailureTellsADeveloperWhatToSetAndAnOperatorWhyNotTo() {
        // Both audiences hit this message, and they need opposite actions from it. A developer who
        // only learns "set DRAAZY_DEV_MACHINE" will paste that into the server that just crash-
        // looped, which is precisely the outcome the control exists to prevent.
        String message = LocalProfileGuard.missingAttestationMessage();

        assertThat(message)
                .contains("DRAAZY_DEV_MACHINE=1 once in your user environment")
                .contains("docs/LOCAL_DEV.md")
                .contains("Nothing in the repository sets it for you")
                .contains("this failure is the control working")
                .contains("Remove 'local' from spring.profiles.active");
    }

    @Test
    void aBlankValueIsNotAnAttestation() {
        // `DRAAZY_DEV_MACHINE=` in a shell profile, or a trailing-whitespace paste, sets the
        // variable to something that exists and means nothing. Treating it as proof would make the
        // control satisfiable by an empty assignment copied along with everything else.
        assertThatThrownBy(() ->
                LocalProfileGuard.assertDevMachineAttested(profiles("local"), name -> "   ", false))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aPropertyEntryCannotStandInForTheEnvironmentVariable() {
        // The whole point of the control: the second signal must not be carryable by a file. Spring
        // would resolve DRAAZY_DEV_MACHINE from either of these entries via relaxed binding, so
        // an application-local.properties or a .env copied off a laptop would satisfy the check if
        // it ever went through the Environment. It does not.
        StandardEnvironment environment = profiles("local");
        environment.getPropertySources().addFirst(new MapPropertySource(
                "a-copied-application-local.properties",
                Map.of("DRAAZY_DEV_MACHINE", "1", "draazy.dev-machine", "1")));

        assertThat(environment.getProperty("DRAAZY_DEV_MACHINE")).isEqualTo("1");
        assertThatThrownBy(() -> LocalProfileGuard.assertDevMachineAttested(environment, UNSET, false))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void withoutTheLocalProfileTheVariableIsNotRequired() {
        // Staging, prod, and the no-profile default all boot with the production providers. Nothing
        // dangerous is registered, so there is nothing to attest to.
        assertThatCode(() -> LocalProfileGuard.assertDevMachineAttested(profiles(), UNSET, false))
                .doesNotThrowAnyException();
        assertThatCode(() -> LocalProfileGuard.assertDevMachineAttested(profiles("prod"), UNSET, false))
                .doesNotThrowAnyException();
    }

    @Test
    void theVariableOnANonLocalInstanceIsToleratedRatherThanFatal() {
        // Worth a WARN (it means the variable has escaped a laptop) but not a crash: refusing to
        // start a healthy production instance over a stray environment variable would be a
        // self-inflicted outage, and no local-only bean is registered here anyway.
        assertThatCode(() -> LocalProfileGuard.assertDevMachineAttested(profiles("prod"), ATTESTED, false))
                .doesNotThrowAnyException();
    }

    @Test
    void theBuildsOwnTestRunIsExempt_whichIsWhatKeepsTheSuiteGreen() {
        // src/test/resources/application.properties activates `local` for the entire suite, because
        // that profile is what wires the keyless providers the tests assert against. The exemption
        // is the alternative to committing the value somewhere, which would hand it to anyone who
        // copies the repo.
        assertThatCode(() -> LocalProfileGuard.assertDevMachineAttested(profiles("local"), UNSET, true))
                .doesNotThrowAnyException();

        // And the exemption is actually detected here, rather than only being detectable in theory.
        // If spring-boot-test ever stops being the marker, this fails on its own instead of taking
        // every @SpringBootTest down with it.
        assertThat(LocalProfileGuard.automatedTestRun()).isTrue();
    }

    @Test
    void aContextUnderTheLocalProfileStillRefreshes() {
        // The end-to-end version of the test above, and the reason the ~880 existing tests survive
        // this change: the guard is a real bean whose SmartInitializingSingleton runs during
        // refresh, under `local`, on a machine that has almost certainly not exported the variable.
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles(LocalProfileGuard.LOCAL_PROFILE);
            context.register(LocalProfileGuard.class);

            assertThatCode(context::refresh).doesNotThrowAnyException();
            assertThat(context.isActive()).isTrue();
        }
    }

    @Test
    void aDeploymentWithAnInsecureRefreshCookieRefusesToStart() {
        // The failure this guards is not a typo anyone makes directly — it is what `prod,local`
        // resolves to. Both files are right; the order decides, and the order does not look like
        // configuration. Asserted against the resolved property rather than the files for the same
        // reason the guard reads it that way.
        assertThatThrownBy(() -> refreshWith(Map.of(
                "draazy.security.refresh-cookie.secure", "false"), "prod"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("thirty-day credential")
                .hasMessageContaining("check the ORDER of SPRING_PROFILES_ACTIVE");
    }

    @Test
    void aLoadBalancerIsEnoughToCountAsADeployment() {
        // The instance that never activates `prod` but sits behind a proxy is still on the public
        // internet. Sharing deploymentEvidence with the local-bean guard is what makes that true
        // here without a second definition of "deployment" to keep in step.
        assertThatThrownBy(() -> refreshWith(Map.of(
                "draazy.security.refresh-cookie.secure", "false",
                "draazy.security.trusted-proxies", "10.0.0.0/8")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("a load balancer is in front of this instance");
    }

    @Test
    void sandboxIsADeploymentToo_whichStoppedBeingFreeWhenTheProfilesWereSplit() {
        // Regression test for a fail-open this change nearly introduced. deploymentEvidence keys on
        // the profile NAME, and sandbox used to be deployed as `prod,sandbox` — so it satisfied the
        // check for free, by naming prod. Making sandbox standalone removed that word from the
        // deployment, and with it the only thing telling the guard that a public, internet-facing
        // environment holding real credentials was not somebody's laptop.
        //
        // Nothing would have failed. Sandbox sets trusted-proxies to `none`, so the load-balancer
        // signal above does not fire there either; the instance would simply have been treated as
        // local, accepting an insecure refresh cookie and — had the profile list ever also included
        // `local` — wiring the mock OTP sender that accepts a fixed code.
        assertThatThrownBy(() -> refreshWith(Map.of(
                "draazy.security.refresh-cookie.secure", "false"), "sandbox"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("the 'sandbox' profile is active");
    }

    @Test
    void aDeveloperMachineMayStillTurnSecureOff() {
        // Local development is plain HTTP, so `secure=true` would mean the browser never stores the
        // refresh cookie and no session survives an access-token expiry. This is the case the guard
        // must not break, and the only reason it is scoped to deployments at all.
        assertThatCode(() -> refreshWith(Map.of(
                "draazy.security.refresh-cookie.secure", "false")))
                .doesNotThrowAnyException();
    }

    @Test
    void secureByDefaultMeansAnUnsetPropertyIsNotAFinding() {
        // The property is absent from a context assembled by hand, as it would be from any
        // environment that simply never mentions it. Defaulting the read to `true` keeps that
        // silence from being reported as a misconfiguration.
        assertThatCode(() -> refreshWith(Map.of(), "prod"))
                .doesNotThrowAnyException();
    }

    /** Refreshes a context carrying just the guard, so the beans run exactly as they do at boot. */
    private static void refreshWith(Map<String, Object> properties, String... profiles) {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles(profiles);
            if (!properties.isEmpty()) {
                context.getEnvironment().getPropertySources()
                        .addFirst(new MapPropertySource("test", properties));
            }
            context.register(LocalProfileGuard.class);
            context.refresh();
        }
    }

    private static StandardEnvironment profiles(String... active) {
        StandardEnvironment environment = new StandardEnvironment();
        environment.setActiveProfiles(active);
        return environment;
    }
}
