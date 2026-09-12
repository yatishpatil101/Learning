package com.draazy.api.security;

import com.draazy.api.common.settings.Setting;
import com.draazy.api.common.settings.SettingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Resolves {@code settings.permissions} — the administrator-editable allow-list — into a yes or no
 * for one {@linkplain Capabilities capability}.
 *
 * <h2>Does editing this map change access control, and by how much?</h2>
 *
 * <p><strong>Yes, and only downwards.</strong> Every capability check in this codebase is
 * {@code and}-ed onto the {@code @PreAuthorize} role guard that was already there (tech debt D67);
 * none of them replaces one, and none of them is ever the only guard on a route. So the map can
 * take capabilities away from a role, and it can hand a capability to a team <em>within</em> a role
 * that already reaches the route — but there is no value an administrator can write into it that
 * lets a buyer reach a staff route, or staff reach an admin-only one. If you want to widen the
 * four-role baseline you have to edit Java, which is the point: this document is edited through a
 * web form by whoever currently holds the admin password.
 *
 * <p><strong>It governs the ops population, keyed the way the document is keyed.</strong> An admin
 * resolves to the literal key {@code admin}; a staff member resolves to their {@link Teams team}.
 * Those are the only keys the seeded document has, and they are the only two things the JWT carries
 * that could address a group of people.
 *
 * <h2>The three ways this answers "yes" without consulting anything</h2>
 *
 * <p>Each of them is a deliberate refusal to invent policy, and each of them lands exactly on the
 * existing role baseline rather than above it — so none of them widens anything, which is the
 * property that matters when the alternative to a rule is a guess.
 *
 * <ol>
 *   <li><strong>No {@code permissions} row.</strong> The platform is then in the state it shipped
 *       in for its whole life so far, and the honest reading of "no policy is configured" is "the
 *       compiled-in policy applies", not "nobody may do anything". This mirrors
 *       {@code PlatformSettings}, which resolves every missing or malformed config value to its
 *       compiled-in default rather than failing the request — for the same reason: a config store an
 *       operator edits by hand must not be able to take the platform down by being absent.</li>
 *   <li><strong>The row is unparseable, or is not a JSON object.</strong> {@code AdminSettings}
 *       declares {@code permissions} as {@code additionalProperties: true}, so an admin can store an
 *       array or a string there and the settings endpoint will accept it. A document whose shape
 *       cannot be an allow-list is not a restrictive allow-list — it is a broken one, and treating a
 *       typo as a lockout of the entire back office would make this class the outage.</li>
 *   <li><strong>The caller is staff with no team.</strong> {@code users.team} is nullable (V2), so a
 *       team-less staff account is legal, and the map has no key that addresses it. Denying would be
 *       inventing a policy nobody wrote; per-account scoping is a separate, still-open item
 *       (tech debt D13, {@code roleId}/{@code moduleAccess}), and this class deliberately does not
 *       pre-empt it.</li>
 * </ol>
 *
 * <h2>And the one way it answers "no" on silence</h2>
 *
 * <p>Once the document <em>is</em> a well-formed object and the caller <em>does</em> have a key, an
 * absent key or a non-array value is a <strong>denial</strong>. That is what makes this an
 * allow-list rather than a suggestion: if omission meant "allow", an administrator could never
 * remove access by editing the map, which is precisely the bug D67 was raised about.
 *
 * <p>The obvious hazard of deny-on-omission is a partial map locking out teams the author never
 * thought about — so {@code R__DML_seed_permission_map.sql} seeds a <em>complete</em> one (every team in
 * {@link Teams}, plus {@code admin}) and merges the defaults into whatever a deployment already had,
 * and the settings endpoint's merge semantics (S60) mean a key cannot subsequently be deleted at
 * all, only emptied. An administrator therefore edits one team's bundle without silently changing
 * five others.
 *
 * <h2>What this does not do</h2>
 *
 * <p>It does not read {@code settings.customRoles}, and as of 2026-08-11 nothing can store one: the
 * key is deleted by {@code V61} and refused with 422 by {@code AdminSettingsService}. It was keyed
 * by a {@code roleId} no user row, JWT claim or endpoint has ever carried, it spoke the admin
 * client's module vocabulary rather than {@link Capabilities}, and it composed by <em>union</em>
 * where this class may only ever narrow — so honouring it would have widened access on the strength
 * of a document written while it granted nothing. Removed rather than wired for exactly that
 * reason; see tech debt D67/D13.
 */
@Component(Capabilities.BEAN)
public class PermissionMap {

    private static final Logger log = LoggerFactory.getLogger(PermissionMap.class);

    /** The settings block this class reads. Seeded by {@code R__DML_seed_permission_map.sql}; written by
     * {@code /admin/settings}. */
    static final String PERMISSIONS_KEY = "permissions";

    private final SettingRepository settings;
    private final ObjectMapper objectMapper;

    public PermissionMap(SettingRepository settings, ObjectMapper objectMapper) {
        this.settings = settings;
        this.objectMapper = objectMapper;
    }

    /**
     * The {@code @PreAuthorize} entry point — {@code @permissions.granted(authentication, '…')}.
     *
     * <p>Anything that is not one of our own authenticated principals is refused rather than waved
     * through. That case is unreachable today (every call site {@code and}s this onto a role check
     * that anonymous cannot pass), so the branch is not load-bearing — but a SpEL fragment is a
     * string, and the day somebody uses one of these constants on its own, the failure should be a
     * 403 rather than a silent grant.
     */
    @Transactional(readOnly = true)
    public boolean granted(Authentication authentication, String capability) {
        if (authentication == null
                || !(authentication.getPrincipal() instanceof AuthPrincipal caller)) {
            return false;
        }
        return granted(caller, capability);
    }

    /** As above, for callers that already hold the resolved principal. */
    @Transactional(readOnly = true)
    public boolean granted(AuthPrincipal caller, String capability) {
        if (caller == null) {
            return false;
        }
        JsonNode allowList = storedAllowList();
        if (allowList == null) {
            return true;
        }
        String key = keyFor(caller);
        if (key == null) {
            return true;
        }
        JsonNode bundle = allowList.get(key);
        if (bundle == null || !bundle.isArray()) {
            return false;
        }
        for (JsonNode entry : bundle) {
            if (!entry.isString()) {
                continue;
            }
            String held = entry.stringValue();
            if (Capabilities.WILDCARD.equals(held) || capability.equals(held)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Which bundle in the document this caller is governed by, or {@code null} if the document has
     * no way to name them.
     *
     * <p>Read off the signature-verified principal and nothing else. There is no request parameter,
     * no header and no body field that can influence which bundle applies — a key the client could
     * choose would be an allow-list the client could opt out of.
     */
    private String keyFor(AuthPrincipal caller) {
        if (Roles.Wire.ADMIN.equals(caller.role())) {
            return Roles.Wire.ADMIN;
        }
        if (Roles.Wire.STAFF.equals(caller.role())) {
            return caller.team();
        }
        return null;
    }

    /**
     * The stored allow-list, or {@code null} for every way it can fail to be one.
     *
     * <p>Read per call rather than cached. The document is one indexed primary-key lookup on a table
     * with a handful of rows, and it is the kind of thing an operator changes in an incident and
     * expects to take effect — a cache here would mean revoking a desk's access and having it keep
     * working for as long as the TTL, which is the worst possible thing for the one control that
     * exists to be revoked in a hurry.
     */
    private JsonNode storedAllowList() {
        try {
            JsonNode document = settings.findById(PERMISSIONS_KEY)
                    .map(Setting::getValue)
                    .map(objectMapper::readTree)
                    .orElse(null);
            if (document == null || !document.isObject()) {
                return null;
            }
            return document;
        } catch (RuntimeException malformed) {
            log.warn("settings.{} could not be read; falling back to role-only authorisation",
                    PERMISSIONS_KEY, malformed);
            return null;
        }
    }
}
