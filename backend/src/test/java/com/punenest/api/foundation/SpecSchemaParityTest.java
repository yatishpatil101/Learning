package com.punenest.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.punenest.api.catalog.property.PropertySearchResponse;
import com.punenest.api.common.web.PageResponse;
import java.io.InputStream;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.RecordComponent;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.yaml.snakeyaml.Yaml;

/**
 * The other half of {@link SpecCoverageTest}: that test proves every declared route is served and
 * every served route is declared, but it says nothing about what those routes <em>return</em>.
 *
 * <p>That gap was load-bearing. Roughly 6,000 of the contract's lines are schemas, and until this
 * test none of them were checked against anything. A renamed DTO field, a property that quietly
 * stopped being serialised, or a schema written for an endpoint that later changed shape all passed
 * a fully green build — and the failure would surface in a generated client, or in the browser, long
 * after the commit that caused it.
 *
 * <p><strong>Why the handler's return type, and not the schema's name.</strong> The obvious
 * implementation matches {@code components.schemas.X} to a Java class called {@code X}. It is wrong
 * here, and dangerously so: the contract's {@code ContactRequest} schema describes the DTO
 * {@code ContactRequestResponse}, while a JPA <em>entity</em> named {@code ContactRequest} also
 * exists. Name-matching would compare the contract against the database entity, agree with itself,
 * and prove nothing. Only 30 of 147 schema names match a record name anyway — the DTOs are variously
 * suffixed {@code Response}, {@code Dto}, {@code Create} or nothing at all. So the link used here is
 * the one the framework itself uses: the type Spring will actually serialise.
 *
 * <p><strong>What is deliberately not checked.</strong> Types, formats, nullability and required-ness
 * are all left alone. Property <em>names</em> are where the drift that reaches a client lives, and
 * checking names only keeps this test free of false positives that would get it disabled. Operations
 * whose return type or response schema this test cannot resolve are skipped rather than guessed at,
 * and {@link #COMPARABLE_FLOOR} stops that skip-list from silently growing into "checks nothing".
 */
@SpringBootTest
@DisplayName("The contract — declared response fields match what the handlers actually return")
class SpecSchemaParityTest {

    /**
     * The number of operations whose response shape this test can resolve on both sides. It may rise
     * and must not fall.
     *
     * <p>Without this floor the test has a silent failure mode that is worse than not having it: a
     * refactor that made return types unresolvable would shrink the comparison to nothing and still
     * report success. The floor converts "I checked less" into a failure.
     */
    private static final int COMPARABLE_FLOOR = 60;

    /** Infrastructure Spring maps for us; none of it is part of the public contract. */
    private static final List<String> NOT_OURS = List.of("/error", "/actuator");

    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlers;

    @Test
    @DisplayName("no declared response field is absent from the type the handler returns")
    void declaredFieldsExist() {
        List<String> drift = new ArrayList<>();
        for (Comparison c : comparisons()) {
            Set<String> missing = new TreeSet<>(c.declared());
            missing.removeAll(c.served());
            if (!missing.isEmpty()) {
                drift.add("%s -> %s declares %s, absent from %s"
                        .formatted(c.operation(), c.schemaName(), missing, c.typeName()));
            }
        }
        assertThat(drift)
                .as("the contract promises fields the handler does not return — a generated client "
                        + "would compile against them and get null. Fix the DTO, or correct the "
                        + "contract")
                .isEmpty();
    }

    @Test
    @DisplayName("no returned field is missing from the contract")
    void servedFieldsAreDeclared() {
        List<String> drift = new ArrayList<>();
        for (Comparison c : comparisons()) {
            Set<String> undeclared = new TreeSet<>(c.served());
            undeclared.removeAll(c.declared());
            if (!undeclared.isEmpty()) {
                drift.add("%s -> %s returns %s, absent from schema %s"
                        .formatted(c.operation(), c.typeName(), undeclared, c.schemaName()));
            }
        }
        assertThat(drift)
                .as("fields are on the wire that the contract does not mention — undocumented "
                        + "surface, and the usual way a field meant to stay internal reaches a "
                        + "client")
                .isEmpty();
    }

    @Test
    @DisplayName("the comparison covers at least as many operations as it used to")
    void coverageOnlyGrows() {
        assertThat(comparisons().size())
                .as("operations whose response shape is resolvable on both sides. If this fell, the "
                        + "other two tests just got weaker without failing — that is the point of "
                        + "the floor")
                .isGreaterThanOrEqualTo(COMPARABLE_FLOOR);
    }

    /** One operation whose response shape could be resolved on both sides. */
    private record Comparison(
            String operation, String schemaName, String typeName, Set<String> declared, Set<String> served) {}

    private List<Comparison> comparisons() {
        Map<String, Object> spec = loadSpec();
        List<Comparison> out = new ArrayList<>();
        handlers.getHandlerMethods().forEach((info, handler) -> {
            var patterns = info.getPathPatternsCondition();
            if (patterns == null) {
                return;
            }
            for (String pattern : patterns.getPatternValues()) {
                if (NOT_OURS.stream().anyMatch(pattern::startsWith)) {
                    continue;
                }
                for (var method : info.getMethodsCondition().getMethods()) {
                    compare(spec, method.name(), pattern, handler).ifPresent(out::add);
                }
            }
        });
        return out;
    }

    private Optional<Comparison> compare(
            Map<String, Object> spec, String verb, String pattern, HandlerMethod handler) {
        Map<String, Object> operation = findOperation(spec, verb, pattern);
        if (operation == null) {
            return Optional.empty();
        }
        Named leaf = leafSchema(spec, successSchema(operation), null);
        if (leaf == null || leaf.schema().get("properties") == null) {
            return Optional.empty();
        }
        Class<?> type = leafType(handler.getMethod().getGenericReturnType());
        if (type == null || !type.isRecord()) {
            return Optional.empty();
        }

        @SuppressWarnings("unchecked")
        Set<String> declared = new TreeSet<>(((Map<String, Object>) leaf.schema().get("properties")).keySet());
        Set<String> served = new TreeSet<String>();
        for (var component : type.getRecordComponents()) {
            if (suppressedFromJson(component)) {
                continue;
            }
            served.add(component.getName());
        }
        return Optional.of(new Comparison(
                verb + " " + pattern,
                leaf.name() == null ? "(inline)" : leaf.name(),
                type.getSimpleName(),
                declared,
                served));
    }

    /**
     * True when Jackson will leave this component out of the body, so this test should too.
     *
     * <p>{@code AuthResponse.refreshToken} is the case that needed it: the component carries the raw
     * token from the service to {@code AuthController}, which puts it in an {@code HttpOnly} cookie
     * rather than the response. Counting it as served would push us to *document* a field whose
     * entire point is that no client ever receives it.
     *
     * <p>All three of component, accessor and field are checked because {@code @JsonIgnore} declares
     * {@code @Target({ANNOTATION_TYPE, METHOD, CONSTRUCTOR, FIELD})} — no {@code RECORD_COMPONENT} —
     * so javac propagates it to the generated members and {@code component.isAnnotationPresent} is
     * false. That reads as "the annotation is not there", which is the trap: it is there, it is
     * working, and only this reflection call cannot see it.
     */
    private static boolean suppressedFromJson(RecordComponent component) {
        if (component.isAnnotationPresent(JsonIgnore.class)
                || component.getAccessor().isAnnotationPresent(JsonIgnore.class)) {
            return true;
        }
        try {
            return component.getDeclaringRecord()
                    .getDeclaredField(component.getName())
                    .isAnnotationPresent(JsonIgnore.class);
        } catch (NoSuchFieldException unreachable) {
            // Every record component has a backing field of the same name; this cannot happen.
            return false;
        }
    }

    /** The 2xx JSON body, or {@code null} when the operation has no JSON response body. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> successSchema(Map<String, Object> operation) {
        Map<String, Object> responses = (Map<String, Object>) operation.get("responses");
        if (responses == null) {
            return null;
        }
        for (String code : List.of("200", "201")) {
            Map<String, Object> response = (Map<String, Object>) responses.get(code);
            if (response == null) {
                continue;
            }
            Map<String, Object> content = (Map<String, Object>) response.get("content");
            if (content == null) {
                continue;
            }
            Map<String, Object> json = (Map<String, Object>) content.get("application/json");
            if (json != null) {
                return (Map<String, Object>) json.get("schema");
            }
        }
        return null;
    }

    /** A schema plus the component name it was reached through, for a readable failure message. */
    private record Named(String name, Map<String, Object> schema) {}

    /**
     * Reduce a response schema to the object whose fields the handler actually returns.
     *
     * <p>Three wrappers are unwrapped, and they mirror the Java side exactly: a {@code $ref} to a
     * component, an array (the handler returns a {@code List}), and the paged {@code allOf} of
     * {@code PageEnvelope} plus a {@code content} array (the handler returns a
     * {@link PageResponse}). Anything else composed with {@code allOf}/{@code oneOf} is returned as
     * {@code null} rather than guessed at — a wrong guess here would be a false failure, and a test
     * that cries wolf gets switched off.
     */
    @SuppressWarnings("unchecked")
    private static Named leafSchema(Map<String, Object> spec, Map<String, Object> schema, String name) {
        if (schema == null) {
            return null;
        }
        if (schema.get("$ref") instanceof String ref) {
            String component = ref.substring(ref.lastIndexOf('/') + 1);
            return leafSchema(spec, deref(spec, component), component);
        }
        if (schema.get("allOf") instanceof List<?> members) {
            for (Object member : members) {
                Map<String, Object> properties = (Map<String, Object>) ((Map<String, Object>) member).get("properties");
                if (properties != null && properties.get("content") != null) {
                    return leafSchema(spec, (Map<String, Object>) properties.get("content"), name);
                }
            }
            return null;
        }
        if (schema.get("items") != null) {
            return leafSchema(spec, (Map<String, Object>) schema.get("items"), name);
        }
        return new Named(name, schema);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> deref(Map<String, Object> spec, String component) {
        Map<String, Object> components = (Map<String, Object>) spec.get("components");
        Map<String, Object> schemas = (Map<String, Object>) components.get("schemas");
        return (Map<String, Object>) schemas.get(component);
    }

    /**
     * Peel the generic wrappers off a handler's return type to reach the record being serialised.
     *
     * <p>{@code ResponseEntity}, {@code PageResponse}, {@code List} and {@code Optional} are all
     * transport, not payload — and each one has an exact counterpart on the schema side, which is
     * what makes the two resolutions comparable. {@link PropertySearchResponse} is the page envelope
     * plus one aggregate about the whole match, and is peeled for the same reason: its extra field
     * is metadata about the result set, declared beside {@code content} in the contract, not part of
     * the payload record whose fields this compares.
     */
    private static Class<?> leafType(Type type) {
        if (type instanceof ParameterizedType parameterized) {
            Class<?> raw = (Class<?>) parameterized.getRawType();
            boolean wrapper = raw == ResponseEntity.class
                    || raw == PageResponse.class
                    || raw == PropertySearchResponse.class
                    || raw == Optional.class
                    || List.class.isAssignableFrom(raw);
            return wrapper ? leafType(parameterized.getActualTypeArguments()[0]) : raw;
        }
        return type instanceof Class<?> clazz ? clazz : null;
    }

    /**
     * Spring's pattern and the contract's path differ only in parameter spelling, so both are
     * compared with parameter names erased — the same rule {@link SpecCoverageTest} uses.
     */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> findOperation(Map<String, Object> spec, String verb, String pattern) {
        Map<String, Map<String, Object>> paths = (Map<String, Map<String, Object>>) spec.get("paths");
        String wanted = erase(pattern);
        for (var entry : paths.entrySet()) {
            if (!erase(entry.getKey()).equals(wanted)) {
                continue;
            }
            for (var operation : entry.getValue().entrySet()) {
                if (operation.getKey().toUpperCase(Locale.ROOT).equals(verb)) {
                    return (Map<String, Object>) operation.getValue();
                }
            }
        }
        return null;
    }

    private static String erase(String path) {
        String erased = path.replaceAll("\\{[^}]+}", "{}");
        return erased.length() > 1 && erased.endsWith("/") ? erased.substring(0, erased.length() - 1) : erased;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> loadSpec() {
        try (InputStream in = getClass().getResourceAsStream("/static/openapi/punenest-api.yaml")) {
            assertThat(in).as("the contract must be on the classpath").isNotNull();
            return (Map<String, Object>) new Yaml().load(in);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException("cannot read the contract", e);
        }
    }
}
