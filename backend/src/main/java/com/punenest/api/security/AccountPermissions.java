package com.punenest.api.security;

import com.punenest.api.common.access.BackOfficeGrant;
import com.punenest.api.common.access.BackOfficeGrantRepository;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Resolves one back-office account's stored permission document into a yes or no for one
 * {@linkplain BackOfficePermissions atom} (tech debt D192/D13).
 *
 * <h2>Narrowing is the only operation, and it is structural</h2>
 *
 * <p>{@link #effectiveFor} builds the compiled-in baseline for the caller's role and applies exactly
 * one operation to it: {@code retainAll}. The result is therefore a <strong>subset of the
 * baseline</strong> by construction — not by convention, not by a rule in a comment, but because a
 * set intersection cannot produce a member neither operand had. An administrator who writes
 * {@code settings:write} into a staff account's document has written a string that the intersection
 * drops on the floor, and {@code AccountPermissionsGuardTest} asserts exactly that.
 *
 * <p>This is the property {@code V61} says the old {@code settings.customRoles} model lacked: it
 * composed {@code BASE ∪ role-bundle ∪ moduleAccess}, a union, and honouring a union server-side is
 * the privilege escalation the narrow-only rule exists to prevent. If a later change replaces the
 * {@code retainAll} below with an {@code addAll}, the escalation is back — which is why the
 * narrowing-direction test is written against a route rather than against this method.
 *
 * <p>The second fence is the one that was already there: every atom is {@code and}-ed onto the
 * {@code @PreAuthorize} role guard on its route and never substituted for one. So even a
 * mis-declared ceiling in the catalogue cannot let a staff account reach an admin-only route.
 *
 * <h2>Why the document is read from the database and not from the token</h2>
 *
 * <p>A capability set embedded in a signed JWT is an allow-list the holder carries. Revoking
 * somebody's access would then not take effect until their token expired, and every token in
 * circulation would be a standing snapshot of a policy that has since changed — the exact failure
 * mode {@code V61} warns about when it calls a client-selected bundle "an allow-list the client opts
 * out of". A per-request lookup makes a revocation land on the next request, which is what an
 * access control that exists to be used during an incident has to do. The token shape is unchanged
 * by this slice: it still carries identity and the coarse role, and nothing else.
 *
 * <p>Read per call rather than cached, for the same reason {@link PermissionMap} is: a cache here
 * would mean revoking a desk's access and having it keep working for the length of the TTL. The
 * cost is one primary-key lookup against a table with a row per <em>scoped</em> ops account, which
 * on this platform is a table that fits in a page.
 *
 * <h2>How each way of having no answer is answered</h2>
 *
 * <ol>
 *   <li><strong>No row.</strong> The account is not scoped, which is every account until an
 *       administrator scopes one, and the honest reading is "the role baseline applies". Anything
 *       else would have made deploying this migration an outage.</li>
 *   <li><strong>A row whose value is not a JSON array of strings.</strong> <strong>Denies
 *       everything</strong> for that one account. This is the deliberate opposite of
 *       {@link PermissionMap}, whose malformed-document fallback is the role baseline — and the
 *       difference is blast radius. That document is platform-wide and is edited through a web form,
 *       so treating a typo as a lockout would make the class the outage. This one is per-account and
 *       is written by an endpoint that validates every name against the catalogue, so a value the
 *       resolver cannot read can only have arrived by a direct database edit, and the safe reading of
 *       "somebody hand-edited an access-control row into a shape the server does not understand" is
 *       to stop honouring it.</li>
 *   <li><strong>An empty array.</strong> A real, storable state meaning "this account reaches no
 *       guarded back-office route", and it is why a row and no row cannot be the same thing.</li>
 *   <li><strong>A name the catalogue does not contain.</strong> Ignored — it cannot be in the
 *       baseline, so the intersection drops it. Nothing is granted by a name the server does not
 *       enforce, which is what stops a stale console key from ever meaning something.</li>
 *   <li><strong>Anything that is not one of our own principals.</strong> Refused. Unreachable today
 *       (every fragment is {@code and}-ed onto a role guard anonymous cannot pass), but a SpEL
 *       fragment is a string, and the day somebody uses one alone the failure should be a 403.</li>
 * </ol>
 */
@Component(BackOfficePermissions.BEAN)
public class AccountPermissions {

    private static final Logger log = LoggerFactory.getLogger(AccountPermissions.class);

    private final BackOfficeGrantRepository grants;
    private final ObjectMapper objectMapper;

    public AccountPermissions(BackOfficeGrantRepository grants, ObjectMapper objectMapper) {
        this.grants = grants;
        this.objectMapper = objectMapper;
    }

    /**
     * The {@code @PreAuthorize} entry point —
     * {@code @accountPermissions.granted(authentication, 'tickets:write')}.
     */
    @Transactional(readOnly = true)
    public boolean granted(Authentication authentication, String permission) {
        if (authentication == null
                || !(authentication.getPrincipal() instanceof AuthPrincipal caller)) {
            return false;
        }
        return granted(caller, permission);
    }

    /** As above, for callers that already hold the resolved principal. */
    @Transactional(readOnly = true)
    public boolean granted(AuthPrincipal caller, String permission) {
        if (caller == null || permission == null) {
            return false;
        }
        return effectiveFor(caller.role(), caller.userId()).contains(permission);
    }

    /**
     * Everything this account may actually do: the role baseline, narrowed by the stored document.
     *
     * <p>Public so that the administration screen can show an operator the outcome rather than the
     * input — a grid that echoes back what was typed cannot show that {@code settings:write} on a
     * staff account does nothing, and a control whose effect is invisible is a control that gets
     * mis-set. It takes a role and an id rather than a principal for exactly that reason: the
     * administrator is asking about somebody else.
     *
     * @param wireRole the target's {@link Roles.Wire} role
     * @param userId   the target's {@code users.id}; {@code null} resolves to the baseline, since
     *                 there is no row that could narrow it
     */
    @Transactional(readOnly = true)
    public Set<String> effectiveFor(String wireRole, UUID userId) {
        Set<String> baseline = BackOfficePermissions.baselineFor(wireRole);
        if (baseline.isEmpty() || userId == null) {
            return baseline;
        }
        Optional<BackOfficeGrant> stored = grants.findById(userId);
        if (stored.isEmpty()) {
            return baseline;
        }
        Set<String> document = parse(userId, stored.get().getPermissions());
        if (document == null) {
            return Set.of();
        }
        // The one operation this class performs on the baseline, and the reason a stored document
        // cannot widen anything: an intersection has no member neither operand had. Iterating the
        // baseline's order rather than the document's is deliberate — the resolved set is rendered
        // to an administrator, and "the role's permissions, minus the ones taken away" reads as a
        // subtraction, which is what it is. A document's own ordering is an input artefact.
        Set<String> effective = new LinkedHashSet<>(baseline);
        effective.retainAll(document);
        return effective;
    }

    /**
     * The stored names, or {@code null} for every way the value fails to be a list of them.
     *
     * <p>Logged at warn with the account id and no contents: which account has an unreadable
     * access-control row is an operational fact somebody needs; what somebody hand-wrote into it is
     * not, and access-control documents do not belong in log aggregation.
     */
    private Set<String> parse(UUID userId, String raw) {
        try {
            JsonNode document = objectMapper.readTree(raw);
            if (!document.isArray()) {
                log.warn("back_office_permissions row for {} is not a JSON array; denying", userId);
                return null;
            }
            Set<String> names = new LinkedHashSet<>();
            for (JsonNode entry : document) {
                if (!entry.isString()) {
                    log.warn("back_office_permissions row for {} holds a non-string entry; denying",
                            userId);
                    return null;
                }
                names.add(entry.stringValue());
            }
            return names;
        } catch (RuntimeException malformed) {
            log.warn("back_office_permissions row for {} could not be parsed; denying", userId,
                    malformed);
            return null;
        }
    }
}
