package com.draazy.api.security;

import java.util.Map;
import java.util.TreeSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ListableBeanFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.util.ClassUtils;

/**
 * Refuses to finish starting an application that is simultaneously a deployment and carrying its own
 * development back doors. Rationale: docs/system/profiles.md#local-profile-guard.
 */
@Configuration
public class LocalProfileGuard {

    private static final Logger log = LoggerFactory.getLogger(LocalProfileGuard.class);

    /** The one profile that turns on the {@link LocalOnly} family. Named here so both sides agree. */
    public static final String LOCAL_PROFILE = "local";

    /**
     * The profile expression a production counterpart carries, so an unnamed, mistyped or unfamiliar
     * profile gets it. The negative of {@link #LOCAL_PROFILE}, since {@code prod} is missing elsewhere.
     */
    public static final String NOT_LOCAL = "!" + LOCAL_PROFILE;

    /**
     * The environment variable a developer exports once, by hand, to say "this box is mine". Absent
     * from every committed file, and read from the process environment only.
     */
    public static final String DEV_MACHINE_VARIABLE = "DRAAZY_DEV_MACHINE";

    /**
     * Every profile that names a real deployment, including standalone {@code sandbox}. Public, so
     * "which profiles are deployments" has exactly one definition to fail open from.
     */
    public static final String[] DEPLOYMENT_PROFILES =
            {LocalProfileGuard.PROD_PROFILE, LocalProfileGuard.SANDBOX_PROFILE};

    /** Production. Named so the array above and everything that reads it cannot drift apart. */
    public static final String PROD_PROFILE = "prod";

    /**
     * The internet-facing environment that is not production. Named once here because a second copy
     * of the string is what disarms the fixed-code guard; referenced through the class name below.
     */
    public static final String SANDBOX_PROFILE = "sandbox";

    /**
     * The deployment profile this instance is running under, or {@code null} on a developer machine.
     * The name rather than a boolean, so a caller can put it in a message an operator can act on.
     */
    public static String activeDeploymentProfile(Environment environment) {
        for (String profile : DEPLOYMENT_PROFILES) {
            if (environment.acceptsProfiles(Profiles.of(profile))) {
                return profile;
            }
        }
        return null;
    }

    /**
     * Present only on a {@code test}-scoped classpath, so its presence identifies the build's own
     * test JVM. See {@link #automatedTestRun()} for why that exemption exists.
     */
    private static final String TEST_FRAMEWORK_MARKER =
            "org.springframework.boot.test.context.SpringBootTest";

    private static final boolean AUTOMATED_TEST_RUN =
            ClassUtils.isPresent(TEST_FRAMEWORK_MARKER, LocalProfileGuard.class.getClassLoader());

    /** Whether the refresh cookie carries {@code Secure}; see {@link #secureCookieGuard}. */
    private static final String REFRESH_COOKIE_SECURE = "draazy.security.refresh-cookie.secure";

    /**
     * Reads one variable out of the process environment, or {@code null} if unset. An interface only
     * because a test cannot unset a variable inside a running JVM; no Spring involvement.
     */
    @FunctionalInterface
    interface OsEnvironment {
        String read(String name);
    }

    @Bean
    SmartInitializingSingleton devMachineAttestationGuard(Environment environment) {
        return () -> assertDevMachineAttested(environment, System::getenv, AUTOMATED_TEST_RUN);
    }

    /**
     * Refuses to boot a deployment whose refresh cookie would travel over plain HTTP, reading the
     * resolved value. Rationale: docs/system/profiles.md#local-profile-guard.
     */
    @Bean
    SmartInitializingSingleton secureCookieGuard(Environment environment) {
        return () -> {
            if (environment.getProperty(REFRESH_COOKIE_SECURE, Boolean.class, true)) {
                return;
            }
            String evidence = deploymentEvidence(environment);
            if (evidence == null) {
                return;
            }
            throw new IllegalStateException(
                    REFRESH_COOKIE_SECURE + " resolved to false on what looks like a real deployment ("
                            + evidence + "). The refresh cookie is a thirty-day credential; without "
                            + "Secure the browser will send it over plain HTTP, where anyone on the "
                            + "network path can read it, and it also loses the __Host- prefix that "
                            + "binds it to this host. Note that "
                            + "application-prod.properties sets this to true — if you did not set "
                            + "REFRESH_COOKIE_SECURE=false yourself, check the ORDER of "
                            + "SPRING_PROFILES_ACTIVE: the last profile to define a property wins, so "
                            + "'prod,local' takes the local value. Put 'prod' last, or drop 'local'.");
        };
    }

    @Bean
    SmartInitializingSingleton localOnlyBeanGuard(ListableBeanFactory beans, Environment environment) {
        return () -> {
            Map<String, Object> devBeans = beans.getBeansWithAnnotation(LocalOnly.class);
            if (devBeans.isEmpty()) {
                return;
            }
            String evidence = deploymentEvidence(environment);
            if (evidence == null) {
                return;
            }
            throw new IllegalStateException(
                    "Development-only beans are registered on what looks like a real deployment ("
                            + evidence + "): " + new TreeSet<>(devBeans.keySet())
                            + ". These accept any OTP code, store uploads on local disk, and let any "
                            + "authenticated account grant itself the Verified badge that "
                            + "owners rely on to decide who may contact them. Remove '"
                            + LOCAL_PROFILE + "' from spring.profiles.active, or — if this really is a "
                            + "developer machine — unset draazy.security.trusted-proxies back to '"
                            + TrustedProxyConfig.NO_PROXY + "'.");
        };
    }

    /**
     * Throws unless the {@code local} profile is backed by a machine that has attested to being a
     * developer's. The environment is consulted only for active profiles, never for the variable.
     */
    static void assertDevMachineAttested(
            Environment environment, OsEnvironment osEnvironment, boolean automatedTestRun) {
        String attestation = osEnvironment.read(DEV_MACHINE_VARIABLE);
        boolean attested = attestation != null && !attestation.isBlank();

        if (!environment.acceptsProfiles(Profiles.of(LOCAL_PROFILE))) {
            if (attested) {
                // Harmless as it stands, but it means the variable has leaked off a laptop into a
                // server's environment, one SPRING_PROFILES_ACTIVE edit from disarming the check below.
                log.warn("{} is set but the '{}' profile is not active. Nothing is weakened right "
                                + "now, but that variable is a security control meant to exist only "
                                + "on developer machines; if this is a server, unset it.",
                        DEV_MACHINE_VARIABLE, LOCAL_PROFILE);
            }
            return;
        }
        if (attested || automatedTestRun) {
            return;
        }
        throw new IllegalStateException(missingAttestationMessage());
    }

    /**
     * The text a developer sees when they forget the variable. Extracted so a test can pin the
     * wording: a control that fails with a bare exception gets disarmed by whoever is on call.
     */
    static String missingAttestationMessage() {
        return "The '" + LOCAL_PROFILE + "' profile is active but the " + DEV_MACHINE_VARIABLE
                + " environment variable is not set, so nothing here proves this JVM is a "
                + "developer's machine.\n"
                + "  On a developer machine: set " + DEV_MACHINE_VARIABLE + "=1 once in your user "
                + "environment and start again — docs/LOCAL_DEV.md has the exact command. Nothing "
                + "in the repository sets it for you: not run-local.ps1, not the VS Code task, not "
                + ".env.local, because a control that a committed file can satisfy is not a "
                + "control.\n"
                + "  On a server this failure is the control working, and setting the variable is "
                + "the wrong fix: the '" + LOCAL_PROFILE + "' profile registers beans that accept any "
                + "six-digit OTP, write every OTP in plain text to the application log, store KYC "
                + "documents on the container's ephemeral disk, and expose an endpoint that lets "
                + "any authenticated account award itself the Verified badge that owners "
                + "use to decide who may contact them. Remove '" + LOCAL_PROFILE + "' from "
                + "spring.profiles.active (SPRING_PROFILES_ACTIVE) instead.\n"
                + "  " + DEV_MACHINE_VARIABLE + " is deliberately absent from every committed file, "
                + "so it cannot arrive by copying a .env, a Dockerfile or an "
                + "application*.properties, and it is read with System.getenv rather than through "
                + "the Spring Environment so that a property entry cannot satisfy it either.";
    }

    /**
     * Whether this JVM is the build's own test run, in which case the attestation is not required.
     * Rationale: docs/system/profiles.md#local-profile-guard.
     */
    static boolean automatedTestRun() {
        return AUTOMATED_TEST_RUN;
    }

    /**
     * Why this instance is believed to be a deployment, or {@code null} if nothing says it is.
     * Phrased as the evidence so the startup failure names which of the two signals fired.
     */
    private static String deploymentEvidence(Environment environment) {
        String profile = activeDeploymentProfile(environment);
        if (profile != null) {
            return "the '" + profile + "' profile is active";
        }
        String proxies = environment.getProperty(
                "draazy.security.trusted-proxies", TrustedProxyConfig.NO_PROXY).trim();
        if (!proxies.isEmpty() && !TrustedProxyConfig.NO_PROXY.equalsIgnoreCase(proxies)) {
            return "draazy.security.trusted-proxies=" + proxies
                    + ", so a load balancer is in front of this instance";
        }
        return null;
    }
}
