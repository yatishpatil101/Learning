package com.punenest.api.admin;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.support.PropertiesLoaderUtils;

/**
 * The one link in the D63/D65 chain that no Spring test can reach.
 *
 * <p><strong>Why the obvious tests do not cover this.</strong>
 * {@code src/test/resources/application.properties} <em>shadows</em> the main file rather than
 * merging with it — same filename, test classpath first — so
 * {@link AdminFinanceDisclosureTest} never loads {@code src/main/resources/application.properties}
 * at all. It proves the {@code :false} fallback compiled into the {@code @Value} expression, and
 * nothing more. {@link AdminFinanceDisclosureEnabledTest} supplies the keys itself, so it proves
 * the annotation matches the string the test spells — the same literal, twice.
 *
 * <p>The consequence is precise: if {@code application.properties} said
 * {@code punenest.finance.payout-measured} (singular), or wrote the placeholder as
 * {@code ${FINANCE_PAYOUT_MEASURED:false}}, both of those tests would stay green and
 * {@code FINANCE_PAYOUTS_MEASURED=true} in production would do nothing at all. The whole point of
 * this change is that an operator can flip a disclosure without a code change; the env variable is
 * the interface they use, and until this test existed it was the only part of the mechanism with
 * nothing checking it.
 *
 * <p>So the key names are not written down here. They are read back out of the {@code @Value}
 * constants on {@link AdminMetricsService} by reflection, which means the annotation and the
 * properties file cannot drift apart without this failing — there is no third copy to keep in
 * sync. Deliberately a plain JUnit test: it reads two files and needs no application context, and
 * therefore no database connections (see the context-budget note in
 * {@code src/test/resources/application.properties}).
 */
@DisplayName("punenest.finance.* — the annotation and the deployed file agree")
class AdminFinancePropertyContractTest {

    /** {@code ${some.key:default}} — group 1 is the key, group 2 the default. */
    private static final Pattern VALUE_EXPRESSION = Pattern.compile("^\\$\\{([^:}]+):([^}]*)}$");

    /** {@code ${SOME_ENV:default}} on the right-hand side of a properties line. */
    private static final Pattern ENV_PLACEHOLDER = Pattern.compile("^\\$\\{([A-Z0-9_]+):([^}]*)}$");

    /**
     * Surefire sets {@code basedir} to the module root; the VS Code runner starts a level up. Same
     * reason and same fix as {@code ProdProfileContractTest}.
     */
    private static final Path MODULE = Path.of(System.getProperty("basedir", "")).toAbsolutePath();

    /** Constant name on {@link AdminMetricsService} → the env variable it must be overridable by. */
    private static final Map<String, String> CONSTANT_TO_ENV = Map.of(
            "PAYOUTS_MEASURED_PROPERTY", "FINANCE_PAYOUTS_MEASURED",
            "REFUNDS_MEASURED_PROPERTY", "FINANCE_REFUNDS_MEASURED",
            "SERVICE_ORDERS_COUNTED_PROPERTY", "FINANCE_SERVICE_ORDERS_COUNTED");

    /**
     * The deployed base file, read from the source tree. Not {@code ClassPathResource}: on the test
     * classpath that name resolves to the shadowing test file, which is the exact confusion this
     * class exists to remove.
     */
    private static Properties deployedProperties() throws IOException {
        Path file = MODULE.resolve("src/main/resources/application.properties");
        assertThat(file)
                .as("run this from the backend module — the working directory was %s", MODULE)
                .exists();
        return PropertiesLoaderUtils.loadProperties(new FileSystemResource(file));
    }

    /** Reads a {@code private static final String} {@code @Value} expression off the service. */
    private static String expression(String constantName) throws ReflectiveOperationException {
        Field field = AdminMetricsService.class.getDeclaredField(constantName);
        field.setAccessible(true);
        return (String) field.get(null);
    }

    /** Constant name → the property key it reads, parsed out of the {@code @Value} expression. */
    private static Map<String, String> declaredKeys() throws ReflectiveOperationException {
        Map<String, String> keys = new LinkedHashMap<>();
        for (String constant : CONSTANT_TO_ENV.keySet()) {
            String raw = expression(constant);
            Matcher matcher = VALUE_EXPRESSION.matcher(raw);
            assertThat(matcher.matches())
                    .as("%s must be a ${key:default} expression, was %s", constant, raw)
                    .isTrue();
            keys.put(constant, matcher.group(1));
        }
        return keys;
    }

    /**
     * The failure this catches is silent in both directions: a key present in the file but spelled
     * differently from the annotation is ignored by Spring, and a key the annotation reads but the
     * file never mentions has no discoverable env override. Either way the operator sets the
     * variable, nothing changes, and the screen goes on disclosing — or worse, goes on
     * <em>not</em> disclosing — with no error anywhere.
     */
    @Test
    void everyDisclosureFlagIsDeclaredInTheFileUnderTheNameTheAnnotationReads() throws Exception {
        Properties deployed = deployedProperties();
        for (Map.Entry<String, String> entry : declaredKeys().entrySet()) {
            assertThat(deployed.stringPropertyNames())
                    .as(
                            "%s reads '%s', but application.properties does not declare it — the env"
                                    + " override would be undiscoverable and, if misspelled, inert",
                            entry.getKey(), entry.getValue())
                    .contains(entry.getValue());
        }
    }

    /**
     * The env variable is the interface an operator actually touches, so it is pinned by name.
     * Renaming it is a breaking change to a deployment, which should require editing a test that
     * says so rather than passing quietly.
     */
    @Test
    void eachFlagIsOverridableByTheEnvironmentVariableTheDocumentationNames() throws Exception {
        Properties deployed = deployedProperties();
        for (Map.Entry<String, String> entry : declaredKeys().entrySet()) {
            String value = deployed.getProperty(entry.getValue());
            Matcher matcher = ENV_PLACEHOLDER.matcher(value);
            assertThat(matcher.matches())
                    .as("%s must be '${ENV:default}' so a deploy can override it, was %s",
                            entry.getValue(), value)
                    .isTrue();
            assertThat(matcher.group(1))
                    .as("%s is the variable documented in docs/flows/admin/finance.md",
                            entry.getValue())
                    .isEqualTo(CONSTANT_TO_ENV.get(entry.getKey()));
        }
    }

    /**
     * The default has to be today's truth in <em>both</em> places. A disclosure that defaults to
     * "measured" is an affirmative claim that a figure means something, made by a system with no
     * way to produce it — and it is what a stray {@code true} in either the file or the annotation
     * would silently ship.
     */
    @Test
    void nothingClaimsToBeMeasuredBeforeAnyPathHasShipped() throws Exception {
        Properties deployed = deployedProperties();
        for (Map.Entry<String, String> entry : declaredKeys().entrySet()) {
            Matcher annotation = VALUE_EXPRESSION.matcher(expression(entry.getKey()));
            assertThat(annotation.matches()).isTrue();
            assertThat(annotation.group(2))
                    .as("the @Value fallback for %s must default to false", entry.getValue())
                    .isEqualTo("false");

            Matcher file = ENV_PLACEHOLDER.matcher(deployed.getProperty(entry.getValue()));
            assertThat(file.matches()).isTrue();
            assertThat(file.group(2))
                    .as("the deployed default for %s must be false", entry.getValue())
                    .isEqualTo("false");
        }
    }
}
