package com.punenest.api.security;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The per-account back-office permission vocabulary — {@code module:action} — and the compiled-in
 * role baseline it is subtracted from (tech debt D192/D13).
 *
 * <h2>What an atom is, and why this shape</h2>
 *
 * <p>Every name here is {@code <module>:<action>} with {@code action} one of {@link #READ} or
 * {@link #WRITE}: {@code tickets:read}, {@code users:write}. The split is the product decision
 * behind D192 — "the admin creates an ops user and picks that user's permissions directly" — and
 * read/write is the coarsest split that expresses the request an ops lead actually makes, which is
 * "let them see the queue without letting them act on it". A finer per-route vocabulary was
 * rejected: it would have to be re-derived every time a route is added, and a permission an
 * administrator cannot name in a sentence is one they will grant by accident.
 *
 * <h2>Every name here guards a real route</h2>
 *
 * <p><strong>This catalogue contains exactly what is enforced, and nothing else.</strong> That is
 * the whole lesson of {@code V61}: {@code settings.customRoles} held a vocabulary
 * ({@code enquiries}, {@code properties:verify}) that no server code mapped onto anything, so an
 * administrator populated an access-control document that granted nothing, and the day somebody
 * wired it, it would have started granting whatever had accumulated. So a name is added here in the
 * same change that annotates the route it guards, never before — and {@code BackOfficeAccessService}
 * refuses to store a name that is not in {@link #CATALOGUE}, which is what stops the console's
 * module keys from reappearing in the database under a different roof.
 *
 * <p>{@link Capabilities} deliberately keeps one unenforced name ({@code export_csv}) because it is
 * <em>stored data</em> that predates the guard and cannot be renamed without a migration. This
 * vocabulary has no such history: it ships with its guards, so it can hold the stricter rule.
 *
 * <h2>The role ceiling — why a grant can never exceed the baseline</h2>
 *
 * <p>Each atom records which roles may <em>ever</em> hold it, taken from the {@code @PreAuthorize}
 * role guard already on the route it guards. {@link #baselineFor(String)} turns that into the set an
 * unscoped account of that role holds, and {@link AccountPermissions} resolves a stored document by
 * intersecting it with that set. So an administrator who writes {@code settings:write} into a staff
 * account's document changes nothing: the atom is not in the staff baseline, the intersection drops
 * it, and the route's own {@code hasRole('ADMIN')} would have refused it anyway. Two independent
 * fences, deliberately — if the ceiling below were ever mis-declared too generously, the role guard
 * on the route is still there.
 *
 * <p>Roles outside the back office ({@code buyer}, {@code owner}) get an empty baseline, so the
 * intersection is empty for them whatever they store. That branch is unreachable — every atom is
 * {@code and}-ed onto a role guard those roles cannot pass — but it is the fail-closed answer, and a
 * SpEL fragment is a string that somebody could one day use on its own.
 */
public final class BackOfficePermissions {

    private BackOfficePermissions() {
    }

    /** See, list, open. Never implies the ability to change anything. */
    public static final String READ = "read";

    /** Create, edit, decide, archive — every state-changing route of the module. */
    public static final String WRITE = "write";

    /**
     * The name {@link AccountPermissions} is registered under, so the SpEL fragments below and the
     * {@code @Component} annotation cannot drift apart. Distinct from {@link Capabilities#BEAN}:
     * the two are different axes and are resolved from different storage.
     */
    public static final String BEAN = "accountPermissions";

    /** {@code GET /admin/dashboard}, {@code GET /admin/analytics} — staff and admin. */
    public static final String DASHBOARD_READ = "dashboard:read";

    /** {@code GET /admin/finance} — admin only, as the route already is. */
    public static final String FINANCE_READ = "finance:read";

    /** {@code GET /admin/settings} — admin only. */
    public static final String SETTINGS_READ = "settings:read";

    /** {@code PUT /admin/settings} — admin only. The one that can edit every other policy. */
    public static final String SETTINGS_WRITE = "settings:write";

    /** {@code GET /users}, {@code GET /users/{id}} — staff and admin. */
    public static final String USERS_READ = "users:read";

    /**
     * {@code POST /users/staff}, {@code PATCH /users/{id}}, archive and restore — admin only. The
     * privilege-escalation surface: whoever holds this can mint an admin colleague.
     */
    public static final String USERS_WRITE = "users:write";

    /** {@code GET /admin/audit-log} — admin only, and deliberately not staff-visible. */
    public static final String AUDIT_READ = "audit:read";

    /** {@code GET /admin/content/{type}} — staff and admin. */
    public static final String CONTENT_READ = "content:read";

    /** CMS create/update/archive/restore — staff and admin. */
    public static final String CONTENT_WRITE = "content:write";

    /** {@code GET /tickets} — the ops board. Rows are additionally team-scoped in the service. */
    public static final String TICKETS_READ = "tickets:read";

    /** {@code PATCH /tickets/{id}} and its notes route. */
    public static final String TICKETS_WRITE = "tickets:write";

    /** {@code GET /reports} — the abuse queue. */
    public static final String REPORTS_READ = "reports:read";

    /** {@code PATCH /reports/{id}} — triage, including enforcement. */
    public static final String REPORTS_WRITE = "reports:write";

    /**
     * {@code GET /admin/conversations/{id}} — read one private chat as a moderator (D53).
     *
     * <p><strong>Admin only, and separate from {@link #REPORTS_READ}.</strong> Two decisions worth
     * spelling out. Separate, because reading the abuse queue and reading the correspondence it
     * refers to are different amounts of access to the same incident: a triage desk can route and
     * close most reports on the report text alone, and folding this into {@code reports:read} would
     * hand every one of them the whole conversation as a side effect. Admin only, because the guard
     * this exempts — {@code ConversationService.mine} — admits <em>nobody</em> but the two
     * participants today, and widening a surface from "two people" to "the whole ops floor" in one
     * step is not a narrowing anyone can undo: the permission model subtracts from a role baseline
     * and can never grant above it, so an admin-only atom is the strongest ceiling this file can
     * express. If the moderation desk turns out to need it routinely, the change is one word here
     * ({@code adminOnly} → {@code ops}) and is reviewable as such.
     *
     * <p>There is no {@code conversations:write}. A moderator may read a reported thread and may not
     * post into it — enforcement happens on the report, not in someone else's chat.
     */
    public static final String CONVERSATIONS_READ = "conversations:read";

    /** The four flatmate moderation queues. */
    public static final String FLATMATES_READ = "flatmates:read";

    /** Flatmate review, post and group-application decisions. */
    public static final String FLATMATES_WRITE = "flatmates:write";

    /**
     * One entry of the catalogue, as the admin console reads it.
     *
     * @param name       the atom, {@code module:action} — the exact string stored and checked
     * @param module     the console grouping; several atoms share one
     * @param action     {@link #READ} or {@link #WRITE}
     * @param adminOnly  whether the route's own role guard is {@code admin}-only, so a staff account
     *                   can never hold this however the document is written. Advisory to the UI and
     *                   authoritative in {@link #baselineFor(String)} — the two are the same field
     *                   precisely so a screen cannot offer a checkbox the server would ignore.
     */
    public record Permission(String name, String module, String action, boolean adminOnly) {
    }

    private static Permission ops(String module, String action) {
        return new Permission(module + ":" + action, module, action, false);
    }

    private static Permission adminOnly(String module, String action) {
        return new Permission(module + ":" + action, module, action, true);
    }

    /**
     * Every atom the server enforces, in the order a console should render them.
     *
     * <p>A {@code List} rather than a {@code Set} because the order is part of what is served: the
     * grid an administrator ticks reads top to bottom, and "modules in the order they appear in the
     * back office, read before write" is a decision worth making here once rather than in each
     * client.
     */
    public static final List<Permission> CATALOGUE = List.of(
            ops("dashboard", READ),
            adminOnly("finance", READ),
            ops("users", READ),
            adminOnly("users", WRITE),
            ops("content", READ),
            ops("content", WRITE),
            ops("tickets", READ),
            ops("tickets", WRITE),
            ops("reports", READ),
            ops("reports", WRITE),
            adminOnly("conversations", READ),
            ops("flatmates", READ),
            ops("flatmates", WRITE),
            adminOnly("audit", READ),
            adminOnly("settings", READ),
            adminOnly("settings", WRITE));

    private static final Map<String, Permission> BY_NAME = byName();
    private static final Set<String> ADMIN_BASELINE = baseline(true);
    private static final Set<String> STAFF_BASELINE = baseline(false);

    private static Map<String, Permission> byName() {
        Map<String, Permission> index = new LinkedHashMap<>();
        for (Permission permission : CATALOGUE) {
            if (index.put(permission.name(), permission) != null) {
                throw new IllegalStateException(
                        "duplicate back-office permission: " + permission.name());
            }
        }
        return Map.copyOf(index);
    }

    private static Set<String> baseline(boolean admin) {
        Set<String> names = new LinkedHashSet<>();
        for (Permission permission : CATALOGUE) {
            if (admin || !permission.adminOnly()) {
                names.add(permission.name());
            }
        }
        return Set.copyOf(names);
    }

    /** Is this a name the server enforces? Used to reject a write, never to grant access. */
    public static boolean isKnown(String name) {
        return name != null && BY_NAME.containsKey(name);
    }

    /**
     * Everything an <em>unscoped</em> account of this role holds — the ceiling a stored document is
     * intersected with, and can therefore never rise above.
     *
     * <p>Keyed by the wire role ({@link Roles.Wire}) because that is what the principal carries.
     * Anything that is not staff or admin resolves to the empty set: those roles have no back-office
     * baseline to narrow, so there is nothing an intersection could produce for them.
     */
    public static Set<String> baselineFor(String wireRole) {
        if (Roles.Wire.ADMIN.equals(wireRole)) {
            return ADMIN_BASELINE;
        }
        if (Roles.Wire.STAFF.equals(wireRole)) {
            return STAFF_BASELINE;
        }
        return Set.of();
    }

    /** Everything before the atom in a {@code @PreAuthorize} fragment. */
    private static final String CALL = "@" + BEAN + ".granted(authentication, '";

    /**
     * SpEL fragments for {@code @PreAuthorize}, one per atom.
     *
     * <p>Spelled out as concatenations of constants rather than built by a helper, for the same
     * reason {@link Capabilities} does it: an annotation argument must be a compile-time constant
     * expression, and a method call is not one.
     *
     * <p><strong>Always {@code and}-ed onto the role guard that was already on the route, never used
     * alone.</strong> That is not a convention, it is the mechanism: this document may narrow what a
     * role can do and may never be the thing that decides whether the caller is ops.
     */
    public static final String REQUIRE_DASHBOARD_READ = CALL + DASHBOARD_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_FINANCE_READ = CALL + FINANCE_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_SETTINGS_READ = CALL + SETTINGS_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_SETTINGS_WRITE = CALL + SETTINGS_WRITE + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_USERS_READ = CALL + USERS_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_USERS_WRITE = CALL + USERS_WRITE + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_AUDIT_READ = CALL + AUDIT_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_CONTENT_READ = CALL + CONTENT_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_CONTENT_WRITE = CALL + CONTENT_WRITE + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_TICKETS_READ = CALL + TICKETS_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_TICKETS_WRITE = CALL + TICKETS_WRITE + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_REPORTS_READ = CALL + REPORTS_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_REPORTS_WRITE = CALL + REPORTS_WRITE + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_CONVERSATIONS_READ = CALL + CONVERSATIONS_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_FLATMATES_READ = CALL + FLATMATES_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_FLATMATES_WRITE = CALL + FLATMATES_WRITE + "')";
}
