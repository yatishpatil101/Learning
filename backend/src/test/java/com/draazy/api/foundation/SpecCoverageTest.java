package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.yaml.snakeyaml.Yaml;

/** Measures the routes Spring actually maps against the contract rather than assuming they agree.
 *  Rules and rationale: {@code docs/system/api-standards.md} §1.1. */
@SpringBootTest
@DisplayName("The contract — every served route is declared, and coverage only grows")
class SpecCoverageTest {

    /** A floor, not a target: the running sum of what each slice added, so a slice that silently
     *  unmaps an operation fails the build. See {@code docs/system/api-standards.md} §1.1. */
    private static final int IMPLEMENTED_FLOOR = 259;

    /** Infrastructure Spring maps for us; none of it is part of the public contract. */
    private static final List<String> NOT_OURS = List.of("/error", "/actuator");

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlers;

    @Test
    @DisplayName("no route is served that the contract does not declare")
    void noUndeclaredRoutes() {
        Set<String> declared = declaredOperations();
        Set<String> undeclared = new TreeSet<>(servedOperations());
        undeclared.removeAll(declared);

        assertThat(undeclared)
                .as("routes served but absent from draazy-api.yaml — add them to the contract "
                        + "first, or delete the handler")
                .isEmpty();
    }

    /** The direction the coverage ratchet cannot see: a declaration nothing serves 404s for every
     *  client generated from the contract. Held as an exact set — see api-standards.md §1.1. */
    @Test
    @DisplayName("no route is declared that nothing serves")
    void noUnimplementedDeclarations() {
        Set<String> served = servedOperations();
        Set<String> unserved = new TreeSet<>(declaredOperations());
        unserved.removeAll(served);

        assertThat(unserved)
                .as("operations in draazy-api.yaml with no handler — a client generated from the "
                        + "contract gets a 404 from a promise the document made. Implement it, or "
                        + "remove it from the contract")
                .isEmpty();
    }

    @Test
    @DisplayName("implemented operations never go backwards")
    void coverageOnlyGrows() {
        Set<String> implemented = new TreeSet<>(declaredOperations());
        implemented.retainAll(servedOperations());

        assertThat(implemented.size())
                .as("implemented operations out of %d in the contract", declaredOperations().size())
                .isGreaterThanOrEqualTo(IMPLEMENTED_FLOOR);
    }

    private Set<String> servedOperations() {
        Set<String> served = new TreeSet<>();
        handlers.getHandlerMethods().forEach((info, handler) -> {
            var patterns = info.getPathPatternsCondition();
            if (patterns == null || isLocalOnly(handler)) {
                return;
            }
            for (String pattern : patterns.getPatternValues()) {
                if (NOT_OURS.stream().anyMatch(pattern::startsWith)) {
                    continue;
                }
                for (var method : info.getMethodsCondition().getMethods()) {
                    served.add(method.name() + " " + erase(pattern));
                }
            }
        });
        return served;
    }

    /** A {@code @LocalOnly} controller answers 404 wherever clients live, so declaring its routes
     *  would publish the rot this test catches. Keyed on the marker, not the profile expression. */
    private static boolean isLocalOnly(org.springframework.web.method.HandlerMethod handler) {
        return org.springframework.core.annotation.AnnotatedElementUtils
                .hasAnnotation(handler.getBeanType(), com.draazy.api.security.LocalOnly.class);
    }

    @SuppressWarnings("unchecked")
    private Set<String> declaredOperations() {
        Map<String, Object> spec;
        try (InputStream in = getClass().getResourceAsStream("/static/openapi/draazy-api.yaml")) {
            assertThat(in).as("the contract must be on the classpath").isNotNull();
            spec = new Yaml().load(in);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException("cannot read the contract", e);
        }
        Set<String> declared = new TreeSet<>();
        ((Map<String, Map<String, Object>>) spec.get("paths")).forEach((path, item) ->
                item.keySet().stream()
                        .map(k -> k.toUpperCase(java.util.Locale.ROOT))
                        .filter(SpecCoverageTest::isHttpMethod)
                        .forEach(verb -> declared.add(verb + " " + erase(path))));
        return declared;
    }

    private static boolean isHttpMethod(String key) {
        return List.of("GET", "POST", "PUT", "PATCH", "DELETE").contains(key);
    }

    /** {@code /me/properties/{propId}/docs} and {@code /me/properties/{id}/docs} are one route. */
    private static String erase(String path) {
        String erased = path.replaceAll("\\{[^}]+}", "{}");
        return erased.length() > 1 && erased.endsWith("/")
                ? erased.substring(0, erased.length() - 1)
                : erased;
    }
}
