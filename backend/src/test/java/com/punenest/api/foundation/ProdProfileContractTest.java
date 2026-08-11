package com.punenest.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.support.PropertiesLoaderUtils;
import org.springframework.mock.env.MockEnvironment;

/**
 * {@code application-prod.properties} is a deployment contract that nothing has ever loaded.
 *
 * <p><strong>Why this test exists.</strong> Every other properties file in this project is
 * exercised constantly — the base one boots the app on a developer's machine and under
 * {@code @SpringBootTest} several hundred times a run, so a typo in it is caught within seconds. The
 * prod file is the exact inverse: it is read for the first time by the first production deploy, on
 * infrastructure nobody can attach a debugger to, at the moment the stakes are highest. A misspelled
 * key there does not fail — it is silently ignored, and the base file's value stands. That is the
 * dangerous direction, because the base file's values are the *permissive* ones: local-Postgres
 * credentials, {@code db/seed} in the Flyway path, a loosened OTP throttle, and
 * {@code trusted-proxies=none}. A single typo does not break the deploy; it quietly ships the
 * developer defaults to production and looks completely healthy doing it.
 *
 * <p>This is the same failure shape as {@link ApiContextPathTest}: two layers each holding a
 * coherent belief, disagreeing only where no test looks. The defence there was to start a real
 * container; the defence here is to load the real file and assert on what it actually says, rather
 * than trusting that it says what its comments claim.
 *
 * <p>Deliberately not a {@code @SpringBootTest(properties = "spring.profiles.active=prod")}. Booting
 * under {@code prod} would need a reachable database, real secrets, and would drop the mock
 * providers the rest of the suite depends on — so it would either be skipped in CI or made to pass
 * by supplying exactly the values it is meant to prove are mandatory. Loading the file directly
 * tests the artefact that actually gets deployed, and it runs in milliseconds with no environment.
 */
@DisplayName("The prod profile — a contract nothing else in the suite loads")
class ProdProfileContractTest {

    /**
     * The variables a deploy must supply. This set is the test's whole point: it is the checklist an
     * operator needs before the first deploy, and keeping it here means adding a new {@code ${ENV}}
     * lookup to the prod file fails this test until the person adding it has also decided that the
     * new variable is genuinely mandatory and told whoever runs the deploy about it.
     */
    private static final Set<String> REQUIRED_DEPLOY_VARIABLES = Set.of(
            "DB_URL",
            "DB_USER",
            "DB_PASSWORD",
            "JWT_SECRET",
            "WEB_ORIGINS",
            "CASHFREE_WEBHOOK_SECRET",
            "INTERNAL_PROXIES");

    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{([^}]+)}");

    /**
     * Surefire runs with the working directory set to the module root, but the VS Code test runner
     * defaults to the *workspace* root — one level up, where {@code src/main/resources} does not
     * exist. Preferring Surefire's own {@code basedir} keeps the source-tree reads below working in
     * both, and {@link #mainResource} turns the remaining failure mode into a sentence instead of a
     * bare {@code FileNotFoundException} naming a path nobody expected.
     */
    private static final Path MODULE = Path.of(System.getProperty("basedir", "")).toAbsolutePath();

    private static Properties load(String resource) throws IOException {
        return PropertiesLoaderUtils.loadProperties(new ClassPathResource(resource));
    }

    /**
     * The base file as it will actually be deployed, read from the source tree rather than the
     * classpath.
     *
     * <p>This is not fussiness. {@code src/test/resources/application.properties} shadows the main
     * one for the entire suite, so {@code new ClassPathResource("application.properties")} inside a
     * test silently returns the *test* configuration — which is a different file, written to a
     * different purpose (no seed, throwaway database). The first draft of this test asserted against
     * it by accident and failed, which is the only reason the trap is documented here rather than
     * waiting to mislead the next person who cross-checks a base-file value from a test.
     */
    private static Properties mainResource(String name) throws IOException {
        Path file = MODULE.resolve("src/main/resources").resolve(name);
        assertThat(file)
                .as("run this from the backend module — the working directory was %s", MODULE)
                .exists();
        return PropertiesLoaderUtils.loadProperties(new FileSystemResource(file));
    }

    private static Properties prod() throws IOException {
        // Left on the classpath deliberately: this doubles as proof that the file is packaged into
        // the artefact at all, which mainResource() reading the source tree could never show.
        return load("application-prod.properties");
    }

    /** Every {@code ${...}} placeholder in the file, with any {@code :default} suffix stripped. */
    private static Set<String> placeholdersIn(Properties properties) {
        Set<String> names = new TreeSet<>();
        for (String key : properties.stringPropertyNames()) {
            Matcher matcher = PLACEHOLDER.matcher(properties.getProperty(key));
            while (matcher.find()) {
                String placeholder = matcher.group(1);
                int separator = placeholder.indexOf(':');
                names.add(separator < 0 ? placeholder : placeholder.substring(0, separator));
            }
        }
        return names;
    }

    @Test
    @DisplayName("the file exists and is loadable at all")
    void theProdProfileIsOnTheClasspath() throws IOException {
        // The floor. If this file is ever renamed or excluded from the jar, `-Dspring.profiles
        // .active=prod` becomes a silent no-op: Spring does not complain about a profile with no
        // properties file, so the deploy would come up on the base file's local defaults and report
        // itself healthy. Every other assertion below is meaningless without this one.
        assertThat(prod()).isNotEmpty();
    }

    @Test
    @DisplayName("it requires exactly the documented deploy variables — no more, no fewer")
    void theRequiredEnvironmentIsExactlyWhatIsDocumented() throws IOException {
        assertThat(placeholdersIn(prod()))
                .as("a new ${ENV} lookup here is a new mandatory deploy input; say so out loud")
                .containsExactlyInAnyOrderElementsOf(REQUIRED_DEPLOY_VARIABLES);
    }

    /**
     * The assertions above read <em>values</em>, so none of them can see a misspelled <em>key</em> —
     * and that is the typo with teeth. Rename this file's {@code punenest.security.trusted-proxies}
     * to {@code ...trusted-proxys} and every other test here still passes: the placeholder is still
     * declared, still has no default, still resolves. Spring simply binds nothing, production
     * inherits the base file's {@code none}, and the write rate limiter drops the entire internet
     * into a single bucket. Same shape for {@code spring.datasource.url}, where the silent
     * inheritance is a local-Postgres URL. Naming the keys is the only thing that catches it, and it
     * catches deletion at the same time.
     */
    @Test
    @DisplayName("the keys carrying those variables are spelled the way the app reads them")
    void noSecretBearingKeyIsMisspelledOrMissing() throws IOException {
        assertThat(prod())
                .as("a key the app never reads is inert, and inert means the base file's value wins")
                .containsKeys(
                        "spring.datasource.url",
                        "spring.datasource.username",
                        "spring.datasource.password",
                        "punenest.security.jwt.secret",
                        "punenest.web.cors.allowed-origins",
                        "punenest.webhooks.cashfree.secret",
                        "punenest.security.trusted-proxies");
    }

    /**
     * The half that matters. A {@code ${DB_URL}} that grew a {@code :jdbc:...localhost} default
     * during debugging would still satisfy the test above — and would turn a forgotten secret from a
     * loud boot failure into a production instance quietly pointed at a database that isn't there,
     * or worse, one that is.
     */
    @Test
    @DisplayName("none of them carries a fallback default")
    void noSecretHasADefaultToSilentlyFallBackTo() throws IOException {
        Properties prod = prod();
        for (String key : prod.stringPropertyNames()) {
            String value = prod.getProperty(key);
            Matcher matcher = PLACEHOLDER.matcher(value);
            while (matcher.find()) {
                assertThat(matcher.group(1))
                        .as("%s must fail the boot when unset, not fall back to a default", key)
                        .doesNotContain(":");
            }
        }
    }

    @Test
    @DisplayName("a deploy that supplies all of them resolves cleanly")
    void theContractIsSatisfiableByTheDocumentedSet() throws IOException {
        MockEnvironment environment = environmentSupplying(REQUIRED_DEPLOY_VARIABLES);
        Properties prod = prod();

        // Proves the checklist is sufficient as well as necessary — that an operator who supplies
        // exactly these seven has nothing left to discover at boot.
        for (String key : prod.stringPropertyNames()) {
            assertThatCode(() -> environment.resolveRequiredPlaceholders(prod.getProperty(key)))
                    .as("%s should resolve once the documented variables are present", key)
                    .doesNotThrowAnyException();
        }
    }

    @Test
    @DisplayName("omitting any single one fails resolution rather than defaulting")
    void everyMissingVariableIsFatal() throws IOException {
        Properties prod = prod();

        for (String omitted : REQUIRED_DEPLOY_VARIABLES) {
            Set<String> supplied = new TreeSet<>(REQUIRED_DEPLOY_VARIABLES);
            supplied.remove(omitted);
            MockEnvironment environment = environmentSupplying(supplied);

            String dependentValue = prod.stringPropertyNames().stream()
                    .map(prod::getProperty)
                    .filter(value -> value.contains("${" + omitted + "}"))
                    .findFirst()
                    .orElseThrow(() -> new AssertionError(
                            omitted + " is listed as required but no property in the file reads it"));

            assertThatThrownBy(() -> environment.resolveRequiredPlaceholders(dependentValue))
                    .as("a deploy that forgot %s must not start", omitted)
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining(omitted);
        }
    }

    /**
     * The seed is 38 fabricated listings and 78 fake users, and {@code R__} means Flyway re-runs it
     * whenever its checksum changes. Loading it in production would therefore not seed the catalogue
     * once — it would re-seed it on deploys, indefinitely, with inventory a buyer cannot distinguish
     * from the real thing.
     *
     * <p>The seed is opted into by the {@code dev} profile (D147/D155), so {@code prod} does not
     * inherit it by default. The override below is still load-bearing rather than decorative:
     * profiles are not mutually exclusive, and {@code spring.profiles.active=dev,prod} loads both
     * files. This one is what wins that collision.
     */
    @Test
    @DisplayName("Flyway runs the schema only, never the demo seed")
    void productionNeverRunsTheDevSeed() throws IOException {
        assertThat(prod().getProperty("spring.flyway.locations"))
                .as("a `dev,prod` deploy must still resolve to migration-only")
                .isEqualTo("classpath:db/migration");

        // And the override is only load-bearing because some other profile really does add the seed.
        // If that ever stops being true this fails, which is the correct moment to re-read both files
        // rather than leave a prod override whose comment describes a risk that no longer exists.
        assertThat(mainResource("application-dev.properties").getProperty("spring.flyway.locations"))
                .as("this is what the prod override above exists to beat")
                .contains("db/seed");
    }

    /**
     * The dev profile loosens these to zero cooldown and 100 sends/hour because local development
     * has no SMS gateway. Production sends real codes that cost money and ring a phone belonging to
     * whoever the caller chose, so losing this re-pin turns the OTP endpoint into a free
     * SMS-bombing service pointed at a victim of the caller's choosing.
     */
    @Test
    @DisplayName("the OTP throttle is re-pinned to its secure values")
    void theOtpBudgetIsNotInheritedFromTheLoosenedDevProfile() throws IOException {
        Properties prod = prod();

        assertThat(prod.getProperty("punenest.otp.send-cooldown-seconds")).isEqualTo("60");
        assertThat(prod.getProperty("punenest.otp.max-sends-per-window")).isEqualTo("5");

        Properties dev = mainResource("application-dev.properties");
        assertThat(dev.getProperty("punenest.otp.max-sends-per-window"))
                .as("if dev is no longer the loosened profile, this override needs re-reading")
                .isNotEqualTo("5");
        assertThat(dev.getProperty("punenest.otp.send-cooldown-seconds")).isNotEqualTo("60");
    }

    @Test
    @DisplayName("the actuator surface stays minimal and the logs stay machine-readable")
    void theOperationalSurfaceIsWhatTheDeploymentExpects() throws IOException {
        Properties prod = prod();

        assertThat(prod.getProperty("management.endpoints.web.exposure.include"))
                .as("anything beyond health/info is an unauthenticated information leak")
                .isEqualTo("health,info");
        assertThat(prod.getProperty("management.endpoint.health.probes.enabled")).isEqualTo("true");
        assertThat(prod.getProperty("logging.structured.format.console"))
                .as("the log pipeline parses ECS JSON; plain text arrives as unqueryable blobs")
                .isEqualTo("ecs");
    }

    /**
     * Lives here rather than in the prod file because the port is set once, in the base file, for
     * every profile — but it is only <em>prod</em> that has an opinion about it. Cloud Run injects
     * {@code PORT} and routes traffic only to a container listening on it; a hardcoded port makes
     * the health check fail while the process itself looks perfectly alive, which is the most
     * expensive way to learn this. Nothing else in the suite can see the line: the test resources
     * shadow the base file wholesale, and the tests that bind a real socket use {@code RANDOM_PORT},
     * which wins regardless. So without this assertion the line could be deleted with a green suite.
     */
    @Test
    @DisplayName("the app listens on the port its platform assigns it")
    void theListenPortIsTakenFromTheEnvironment() throws IOException {
        assertThat(mainResource("application.properties").getProperty("server.port"))
                .as("Cloud Run health-checks the port it injected; a fixed port never gets traffic")
                .isEqualTo("${PORT:8080}");
    }

    /**
     * Each named variable resolves to itself, which is enough to prove presence or absence.
     *
     * <p>{@code MockEnvironment} rather than {@code StandardEnvironment}, and the difference is
     * load-bearing: a {@code StandardEnvironment} installs the JVM's real system properties and the
     * OS environment underneath whatever you add, so a variable this method deliberately withholds
     * would still resolve whenever the developer's shell happened to export it. {@code
     * run-local.ps1} exports these exact names into the calling shell, so
     * {@code everyMissingVariableIsFatal} would then pass or fail depending on which terminal ran
     * it — a test that reports on the environment instead of on the file. {@code MockEnvironment}
     * extends {@code AbstractEnvironment}, whose {@code customizePropertySources} is a no-op, so the
     * map below is the entire universe.
     */
    private static MockEnvironment environmentSupplying(Set<String> variables) {
        MockEnvironment environment = new MockEnvironment();
        variables.forEach(name -> environment.setProperty(name, name));
        return environment;
    }
}
