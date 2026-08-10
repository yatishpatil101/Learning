package com.punenest.api.foundation;

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

/**
 * The contract is the source of truth, so the routes the application actually serves are measured
 * against it rather than assumed to agree with it.
 *
 * <p>Two different things are checked, and only one of them is a rule:
 *
 * <ul>
 *   <li><strong>No undeclared route, and no unserved declaration.</strong> The set Spring maps and
 *       the set the OpenAPI document declares must be equal. Served-but-undeclared is a surface
 *       nobody reviewed, and it is exactly how an endpoint ends up shipped without an
 *       {@code x-roles} line ever being considered. Declared-but-unserved is a published promise
 *       that 404s. Only the first was checked originally, which is how {@code GET
 *       /properties/{id}/rooms} survived the whole build-out declared and unimplemented.</li>
 *   <li><strong>A coverage ratchet.</strong> The count of implemented operations may go up and must
 *       not go down. It is a floor, not a target: it catches a slice that silently unmaps something
 *       while adding new work, which a green suite otherwise hides.</li>
 * </ul>
 *
 * <p>Paths are compared with their parameter names erased, because {@code /{id}} and {@code /{propId}}
 * are the same route to a router and differ only in spelling.
 */
@SpringBootTest
@DisplayName("The contract — every served route is declared, and coverage only grows")
class SpecCoverageTest {

    /**
     * Raise this as slices land. Never lower it to make a build pass.
     *
     * <p>Was 178 when slice 15 closed the original build-out. The flatmates backend moved it three
     * times: three legacy {@code /share-flat/*} operations left the contract entirely (V28 retired
     * them), then the flatmates surface was implemented — 7 seeker/inbox operations, 13 for rooms,
     * groups and the mixed feed, 3 for the Ops queue and the moderation axis, and finally 5 for flat
     * splits, owner consent and group applications.
     *
     * <p>The API-polish pass added four: {@code listPropertyRooms} (declared since the flatmates
     * slice and served by nothing), {@code updateSavedSearch}, {@code listListingBoosts} and
     * {@code listReviewsForModeration} — each one a feature whose UI could write but not read.
     *
     * <p>The contract-parity pass (D144) added nine that shipped served but undeclared: the
     * personal-KYC vault ({@code listPersonalDocuments}, {@code uploadPersonalDocument},
     * {@code deletePersonalDocument}) and the managed-property lifecycle ({@code myManagedProperties},
     * {@code registerManagedProperty}, {@code getManagedProperty}, {@code updateManagedProperty},
     * {@code deleteManagedProperty}, {@code publishManagedProperty}).
     *
     * <p>The R2 storage slice added one: {@code uploadPhoto} ({@code POST /me/photos}) — real photo
     * upload to the public bucket, replacing the front end's throwaway {@code data:} URLs.
     *
     * <p>D151 added two: {@code putServiceRequestIdentities} and
     * {@code getServiceRequestIdentities} — the channel that carries the parties' PAN and Aadhaar to
     * the one operator drafting the agreement, after the security pass stopped both reaching the
     * server at all.
     *
     * <p>D51 added one: {@code adminSupportTickets} — the paged platform-wide support queue S47's
     * note said would be needed, once narrowing {@code listSupportTickets} to the caller's own
     * tickets left ops with no support overview at all.
     */
    private static final int IMPLEMENTED_FLOOR = 217;

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
                .as("routes served but absent from punenest-api.yaml — add them to the contract "
                        + "first, or delete the handler")
                .isEmpty();
    }

    /**
     * The other direction, which this test was silent about for its whole life.
     *
     * <p>{@link #noUndeclaredRoutes} asserts served ⊆ declared. That catches a handler nobody wrote
     * down, and it is the rule that matters most because an undeclared route is an unreviewed one.
     * But it says nothing at all about a declared route nobody implemented, and the coverage floor
     * below cannot see one either — a ratchet counts what exists rather than what is missing. So
     * {@code GET /properties/{id}/rooms} sat in the contract, served by no controller, through the
     * entire build-out with a green suite the whole time.
     *
     * <p><strong>Why that is worth a test rather than a note.</strong> The contract is published:
     * {@code /docs} renders it and clients are generated from it. An operation declared and not
     * served is not an omission the caller can detect — it is a promise that 404s, and the client
     * author has no reason to suspect the document over their own code. Spec-first only works if
     * both directions of the equality are enforced; enforcing one of them just moves where the drift
     * accumulates.
     *
     * <p>Held as an exact set rather than a ratchet because unlike the floor there is no legitimate
     * reason for this to be non-empty for long. A declared-but-unserved operation is either the next
     * thing to build (so it fails until it is built, which is the point) or it should come out of
     * the contract.
     */
    @Test
    @DisplayName("no route is declared that nothing serves")
    void noUnimplementedDeclarations() {
        Set<String> served = servedOperations();
        Set<String> unserved = new TreeSet<>(declaredOperations());
        unserved.removeAll(served);

        assertThat(unserved)
                .as("operations in punenest-api.yaml with no handler — a client generated from the "
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
            if (patterns == null || isDevOnly(handler)) {
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

    /**
     * Is this handler's controller absent from production?
     *
     * <p>The contract describes <em>the API clients can call</em>, and clients are generated from it.
     * A controller annotated {@code @DevOnly} is registered only where the {@code dev} profile is
     * named, so declaring its routes would publish an operation that answers 404 everywhere it
     * matters — the exact inverse of the declared-but-unimplemented rot
     * {@code everyDeclaredRouteIsServed} exists to catch. {@code DevVerificationController} is the
     * case in hand (D122): it synthesizes the DigiLocker callback a dev backend never receives.
     *
     * <p>Keyed on the marker annotation rather than on the profile expression behind it (D147). The
     * previous test read the {@code @Profile} value and looked for the literal {@code "!prod"},
     * which meant the exemption silently stopped applying the moment that expression changed — and
     * it did change, to an allowlist. A test that stops exempting is at least loud; one that starts
     * exempting a controller that really does ship is not, so the narrowness matters either way: a
     * controller enabled by some other profile still reaches production under it and must be
     * declared like anything else.
     */
    private static boolean isDevOnly(org.springframework.web.method.HandlerMethod handler) {
        return org.springframework.core.annotation.AnnotatedElementUtils
                .hasAnnotation(handler.getBeanType(), com.punenest.api.security.DevOnly.class);
    }

    @SuppressWarnings("unchecked")
    private Set<String> declaredOperations() {
        Map<String, Object> spec;
        try (InputStream in = getClass().getResourceAsStream("/static/openapi/punenest-api.yaml")) {
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
