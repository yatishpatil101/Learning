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
 * development back doors (tech-debt D147).
 *
 * <p><strong>What is left after the allowlist.</strong> {@link LocalOnly} closes the case where a
 * deploy forgets to say {@code prod}: the mock beans now require the {@code local} profile to be
 * named, so silence produces the safe implementations. It does not close the opposite case, where a
 * deploy says {@code local} — an environment file copied from a developer's machine, a staging box
 * stood up "the same way we run it locally", or a {@code SPRING_PROFILES_ACTIVE=local,prod} that
 * someone added to get readable logs back. Every one of those is a positive statement, so the
 * allowlist honours it and hands a real, internet-reachable deployment a login that accepts any six
 * digits, uploads that land on the container's ephemeral disk, and
 * {@code POST /me/verification/aadhaar/simulate} — meaning any account can award itself the Verified
 * badge that owners use to decide who may contact them. The symptom is not an error; it is a
 * platform whose trust signals quietly mean nothing.
 *
 * <p>Two independent checks run at startup, and they catch different mistakes.
 *
 * <p><strong>1. Has this machine attested to being a developer's?</strong> {@code local} on its own
 * is a string in a file, and files get copied; nothing about reading one tells you whether it was
 * written on a laptop or inherited by a container. Naming the profile is therefore no longer
 * sufficient — the {@value #DEV_MACHINE_VARIABLE} environment variable must be present as well. It
 * appears in no committed file (not the {@code .env} template, not a Dockerfile, not
 * {@code application*.properties}) and it is read with {@link System#getenv(String)} rather than
 * {@link Environment#getProperty(String)} precisely so that adding it to a properties file cannot
 * satisfy it: Spring's relaxed binding would resolve {@code DRAAZY_DEV_MACHINE} from a
 * {@code draazy.dev-machine} entry, which would put the attestation straight back into the set of
 * things a copied file can carry. The variable has to be exported by a human on the machine it
 * describes, which is the one action a mis-provisioned deploy cannot perform by accident.
 *
 * <p>This replaces an earlier attempt to infer the same thing, and it is worth recording why the
 * inference was not enough: it treated the {@code prod} profile or a configured load balancer as
 * proof of a deployment, so a container that terminates its own TLS — no proxy to configure — and
 * receives {@code SPRING_PROFILES_ACTIVE=local} from a copied environment file matched neither
 * marker, and booted silently with every stub live.
 *
 * <p><strong>2. Does this instance look like a deployment regardless?</strong> The inference above,
 * kept rather than replaced, because it catches the opposite error: someone who <em>has</em>
 * exported the variable — a developer's own shell profile, an image built from it — and then runs
 * the result behind a load balancer. Two statements are treated as proof that this instance is not a
 * laptop:
 *
 * <ul>
 *   <li>the {@code prod} profile is active, in which case {@code local} being active alongside it is
 *       a contradiction rather than a preference;</li>
 *   <li>{@code draazy.security.trusted-proxies} names a load balancer. A developer's machine has
 *       nothing in front of it and leaves that at {@code none} ({@link TrustedProxyConfig}), so a
 *       proxy pattern is a deployment topology being described, whatever the profile is called.</li>
 * </ul>
 *
 * <p>Both run as {@link SmartInitializingSingleton}s, so they happen after every bean exists but
 * before the connector accepts traffic: the process dies during boot rather than serving one request
 * with a mock verifier behind it.
 */
@Configuration
public class LocalProfileGuard {

    private static final Logger log = LoggerFactory.getLogger(LocalProfileGuard.class);

    /** The one profile that turns on the {@link LocalOnly} family. Named here so both sides agree. */
    public static final String LOCAL_PROFILE = "local";

    /**
     * The profile expression a production counterpart carries, so it is the implementation an
     * unnamed, mistyped or unfamiliar profile gets. Deliberately the negative of {@link
     * #LOCAL_PROFILE} rather than {@code "prod"}: a bean bound to {@code prod} is missing everywhere
     * else, and a missing {@code OtpSender} means the app does not start at all in staging.
     */
    public static final String NOT_LOCAL = "!" + LOCAL_PROFILE;

    /**
     * The environment variable a developer exports once, by hand, to say "this box is mine".
     * Deliberately absent from every committed file, and read from the process environment only —
     * see the class javadoc.
     */
    public static final String DEV_MACHINE_VARIABLE = "DRAAZY_DEV_MACHINE";

    /**
     * Every profile that names a real deployment. {@code sandbox} is in here because it stopped
     * being {@code prod,sandbox} and became standalone: these checks key on the profile <em>name</em>,
     * so the moment sandbox no longer said {@code prod} it stopped looking like a deployment, and a
     * sandbox that also named {@code local} would have booted with the mock OTP sender and the
     * badge-granting endpoint live.
     *
     * <p>Public, and read by {@code OtpService.rejectFixedCodeInProduction} as well as by this
     * class, because "which profiles are deployments" is exactly the kind of definition that causes
     * a silent fail-open when it exists in two places and only one of them is updated. That is not
     * hypothetical: splitting the sandbox profile disarmed the fixed-OTP-code guard precisely
     * because it held its own copy of the string {@code "prod"}.
     */
    public static final String[] DEPLOYMENT_PROFILES = {"prod", "sandbox"};

    /**
     * The deployment profile this instance is running under, or {@code null} on a developer machine.
     * Returns the name rather than a boolean so callers can put it in their failure message, which
     * is the difference between "this looks like a deployment" and a sentence an operator can act
     * on.
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
     * test JVM. See {@link #automatedTestRun()} for why that exemption exists and what still covers
     * the case it opens.
     */
    private static final String TEST_FRAMEWORK_MARKER =
            "org.springframework.boot.test.context.SpringBootTest";

    private static final boolean AUTOMATED_TEST_RUN =
            ClassUtils.isPresent(TEST_FRAMEWORK_MARKER, LocalProfileGuard.class.getClassLoader());

    /** Whether the refresh cookie carries {@code Secure}; see {@link #secureCookieGuard}. */
    private static final String REFRESH_COOKIE_SECURE = "draazy.security.refresh-cookie.secure";

    /**
     * Reads one variable out of the process environment, or {@code null} if it is unset. A seam with
     * exactly one production implementation ({@link System#getenv(String)}) and no Spring
     * involvement: the entire value of this control is that it consults something a configuration
     * file cannot reach, and the only reason it is an interface at all is that a test cannot unset a
     * variable inside a running JVM.
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
     * Refuses to boot a deployment whose refresh cookie would travel over plain HTTP.
     *
     * <p>{@code application-prod.properties} sets {@code secure=true} and
     * {@code application-local.properties} sets it to {@code false}, which looks like it settles the
     * question and does not: Spring resolves a property from the <em>last</em> profile that defines
     * it, so the answer depends on the order of {@code SPRING_PROFILES_ACTIVE}. {@code prod,local}
     * yields {@code false} and {@code local,prod} yields {@code true}, from two lists that read as
     * the same list. Nobody writes {@code prod,local} on purpose, but a deploy that appends a profile
     * to an existing variable produces it, and profile order is not something an operator has any
     * reason to think of as load-bearing.
     *
     * <p>What that costs is the whole point of the cookie. Without {@code Secure} the browser sends
     * a thirty-day credential over any plain-HTTP request to the site — a stylesheet, a redirect
     * someone typed, a captive portal's interception — and there is no symptom at all: sessions
     * work, tests pass, the cookie is simply readable by anyone on the path. Since the cookie also
     * loses its {@code __Host-} prefix when it is not {@code Secure} (a browser rejects the pair),
     * the same misconfiguration quietly drops host-binding as well.
     *
     * <p>So this reads the <em>resolved</em> value rather than trusting the files, which is the only
     * reading that survives the ordering. It reuses {@link #deploymentEvidence} so that "is this a
     * deployment?" is answered in exactly one place, and so it also catches the instance that never
     * activates {@code prod} but sits behind a load balancer.
     *
     * <p>{@code REFRESH_COOKIE_SECURE=false} is the deliberate override, and it is refused here too.
     * There is no legitimate deployment that needs it: a TLS-terminating proxy in front of this
     * service still speaks HTTPS to the browser, which is the only party the attribute concerns.
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
                            + "authenticated account grant itself the Aadhaar Verified badge that "
                            + "owners rely on to decide who may contact them. Remove '"
                            + LOCAL_PROFILE + "' from spring.profiles.active, or — if this really is a "
                            + "developer machine — unset draazy.security.trusted-proxies back to '"
                            + TrustedProxyConfig.NO_PROXY + "'.");
        };
    }

    /**
     * Throws unless the {@code local} profile is backed by a machine that has attested to being a
     * developer's.
     *
     * @param environment      the Spring environment, consulted <em>only</em> for the active
     *                         profiles; it is deliberately never asked for the variable's value
     * @param osEnvironment    the process environment
     * @param automatedTestRun {@code true} when this JVM is the build's own test run, which is
     *                         exempt — see {@link #automatedTestRun()}
     */
    static void assertDevMachineAttested(
            Environment environment, OsEnvironment osEnvironment, boolean automatedTestRun) {
        String attestation = osEnvironment.read(DEV_MACHINE_VARIABLE);
        boolean attested = attestation != null && !attestation.isBlank();

        if (!environment.acceptsProfiles(Profiles.of(LOCAL_PROFILE))) {
            if (attested) {
                // Harmless as it stands — no @LocalOnly bean is registered — but it means the
                // variable has leaked off a laptop into a server's environment, where it is one
                // SPRING_PROFILES_ACTIVE edit away from having disarmed the check below.
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
     * The text a developer sees when they forget the variable, and an operator sees when a deploy
     * inherits the profile. Extracted so a test can pin the wording: the message <em>is</em> the
     * feature here, because a control that fails with a bare exception gets disarmed by whoever is
     * on call at the time.
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
                + "any authenticated account award itself the Aadhaar Verified badge that owners "
                + "use to decide who may contact them. Remove '" + LOCAL_PROFILE + "' from "
                + "spring.profiles.active (SPRING_PROFILES_ACTIVE) instead.\n"
                + "  " + DEV_MACHINE_VARIABLE + " is deliberately absent from every committed file, "
                + "so it cannot arrive by copying a .env, a Dockerfile or an "
                + "application*.properties, and it is read with System.getenv rather than through "
                + "the Spring Environment so that a property entry cannot satisfy it either.";
    }

    /**
     * Whether this JVM is the build's own test run, in which case the attestation is not required.
     *
     * <p>The suite activates {@code local} for all ~880 of its tests (see
     * {@code src/test/resources/application.properties}) because that profile is what wires the
     * keyless, deterministic providers they assert against. Requiring the variable there would mean
     * either that every developer and every CI job exports it before {@code mvn verify} — a setup
     * step whose omission shows up as a wall of unrelated context-load failures — or that the value
     * is committed somewhere, which is the exact channel this control exists to close.
     *
     * <p>The exemption is keyed on {@value #TEST_FRAMEWORK_MARKER}, which lives in
     * {@code spring-boot-test}. That is a {@code test}-scoped dependency: the class is on the
     * classpath Surefire and the IDE test runner assemble, and is not in the packaged application —
     * {@code spring-boot:run} does not use the test classpath either. Crucially it cannot be turned
     * on from configuration at all; no file, environment variable or command-line flag reaches it,
     * which is the property that keeps the control intact where it matters. The residual case —
     * someone packaging a test-scoped dependency into a deployable artefact — is still covered by
     * {@link #deploymentEvidence}, which is one of the reasons that check was kept rather than
     * replaced.
     */
    static boolean automatedTestRun() {
        return AUTOMATED_TEST_RUN;
    }

    /**
     * Why this instance is believed to be a deployment, or {@code null} if nothing says it is.
     * Phrased as the evidence rather than a boolean so the startup failure tells whoever reads it
     * which of the two signals fired, which is the difference between a one-line fix and an
     * afternoon.
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
