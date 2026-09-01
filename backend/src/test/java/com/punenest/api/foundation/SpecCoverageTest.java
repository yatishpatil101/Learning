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
     *
     * <p>D177 added four: the DPDP right-to-erasure spine — {@code requestErasure} and
     * {@code myErasureRequests} for the subject, {@code listErasureRequests} and
     * {@code decideErasureRequest} for the admin who carries one out or refuses it.
     *
     * <p>D58 added three: the service-order lifecycle, which shipped with none at all —
     * {@code updateServiceOrderStatus} for the desk that quotes and works the job, and
     * {@code acceptServiceOrder} / {@code cancelServiceOrder} for the customer. Until these
     * existed, {@code ServiceOrder.status} and {@code amount} could only be changed by hand-written
     * SQL against production.
     *
     * <p>D190 added four: the ownership gate — {@code recordOwnershipEvidence},
     * {@code verifyOwnership} and {@code revokeOwnershipVerification} for the ops desk that accepts
     * the documents and can take a badge back, and {@code getOwnershipVerification} for the owner
     * who needs to know which of the three required facts their listing is still missing. Until
     * these existed {@code properties.ownership_verified} was written by the demo seed and by
     * nothing else, so the strongest trust claim on the platform could be asserted but never
     * earned.
     *
     * <p>D192/D13 added three: per-account back-office permissions —
     * {@code getPermissionCatalogue} for the console that must render the grid from what the server
     * actually enforces, and {@code getBackOfficePermissions} /
     * {@code replaceBackOfficePermissions} for the administrator who narrows one colleague's
     * access. Until these existed, {@code V61}'s "no team-member management endpoint of any kind"
     * was still true: the Team &amp; Access console wrote to browser storage.
     *
     * <p>D200 added two: staff-account approval — the maker-checker that closes the escalation D192
     * created. A narrowed administrator holding {@code users:write} could mint a fresh
     * administrator, which had no grant row and so resolved to the full role baseline, then sign in
     * as it and recover everything it had lost. Every call in that sequence was individually
     * authorised, which is why no audit rule would have caught it.
     *
     * <p>D194 added four: tenancy declarations — the proof half of review eligibility. The gate had
     * read a browser bucket nothing on the live path writes, so against the real API it was always
     * false and an ex-tenant who never booked a visit could not review the home they lived in.
     *
     * <p>D70 added one: {@code listFlatmatePostInterests} — who answered one flatmate ad. The
     * poster's only per-ad record of a reply had been the notification it sent, so dismissing the
     * notification lost the lead while the row stayed in the table.
     *
     * <p>D94/D15 added two: {@code GET}/{@code PUT /me/notification-preferences}. Channel switches,
     * the master match-alert switch, quiet hours and language had no server surface of any kind —
     * they lived in one browser's localStorage, so the quiet-hours window governed only the alerts
     * the client derived for itself and a server-written notification arrived at 03:00 regardless.
     *
     * <p>D206 added one: {@code redeemStaffInvite}. D200's second signature was co-signing a record
     * rather than a person, because {@code StaffCreate} let the <em>maker</em> choose the new
     * account's password — so a maker could mint a colleague, have a peer approve it in good faith,
     * and then sign in as that colleague. There was no route on which the person the account is for
     * could set their own credential, and this is it.
     *
     * <p>D123 added one: {@code myDocumentAsks} — {@code GET /me/document-requests}. Only the
     * property owner could see document-access requests; the buyer who wrote one had no route on
     * which to find out what became of it, so an ask that was approved or expired looked identical
     * to one nobody had read.
     *
     * <p>D120 added one: {@code getServiceRequestChecklist}. The named paperwork a service request
     * needs existed only in the frontend mock, so the tracker's document column could show what had
     * been uploaded but never what was still missing — which is the half a customer acts on.
     *
     * <p>D49 and D53 added three. D49 gave {@code MessageCreate.attachments} a behaviour instead of
     * a wire field that parsed and vanished, which needs somewhere to put the bytes:
     * {@code attachToConversation} and {@code attachToSupportTicket}. D53 added
     * {@code getConversationForModeration} — a reported chat had no reader, because a conversation
     * admitted its two participants and nobody else.
     *
     * <p>D31b added one: {@code getEntitlements} — {@code GET /me/entitlements}. The free tier's
     * fifteen owner contacts were counted in {@code localStorage}, by a module whose own header said
     * it was not real security: clearing site data reset the quota and a second browser never saw
     * it. The referral bonus that topped it up was computed the same way, from counters the client
     * incremented for itself, so the platform's referral scheme paid a reward the platform never
     * granted. This is the route that made both of those server facts.
     *
     * <p>D32 added three: the managed-property vault — {@code listManagedDocuments},
     * {@code uploadManagedDocument} and {@code deleteManagedDocument}. The Property Passport has
     * always shown a document vault keyed on a managed record, and it was the one part of the
     * document flip that never shipped, because the record ids were minted in the browser. Moving
     * managed properties to this server made those ids real and left the question the missing ids
     * had been standing in for: where the papers on a flat you own but have not listed actually
     * live. Not in {@code documents} — V20 closed that door and V32 set the precedent for opening a
     * new one instead.
     *
     * <p>The floor is a running sum of what each slice added, not the live count. The paragraphs
     * above are that sum's audit trail, and they are the thing to trust: an author who cannot say
     * which operations their delta refers to has not earned the raise. At the time D58 landed the
     * tree actually served 233 — nine operations from work in flight alongside it had not been
     * ratcheted yet. Claiming their number here would make this file assert somebody else's change,
     * and the ratchet would then fail on any branch that has D58 without them. Each slice raises the
     * floor by what it added; the arithmetic catching up is the next author's to do.
     *
     * <p><strong>D25 — the demand board's audited reveals: +3.</strong> {@code GET} on each of
     * {@code /admin/enquiries/&#123;id&#125;}, {@code /admin/visits/&#123;id&#125;} and
     * {@code /admin/deals/&#123;id&#125;}: the row the list already returns, with the one contact
     * number unmasked and an {@code audit_log} entry recording that it was. Three near-identical
     * operations rather than one polymorphic one for the same reason the service has three methods —
     * what varies is whose number it is and where it came from, and on the deals route that
     * difference is the whole point, since the number there may belong to somebody who never held an
     * account.
     */
    private static final int IMPLEMENTED_FLOOR = 253;

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
