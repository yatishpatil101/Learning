package com.draazy.api.security;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The per-account back-office permission vocabulary — {@code module:action} — and the compiled-in
 * role baseline it is subtracted from. Rationale: docs/system/cross-cutting.md#back-office-permissions.
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
     * {@code @Component} annotation cannot drift apart. Distinct from {@link Capabilities#BEAN}.
     */
    public static final String BEAN = "accountPermissions";

    /** {@code GET /admin/dashboard}, {@code GET /admin/analytics} — staff and admin. */
    public static final String DASHBOARD_READ = "dashboard:read";

    /** {@code GET /admin/finance} — admin only, as the route already is. */
    public static final String FINANCE_READ = "finance:read";

    /** {@code GET /admin/settings} — admin only. */
    public static final String SETTINGS_READ = "settings:read";

    /**
     * {@code PUT /admin/settings} and {@code PATCH /admin/cities/{slug}} — admin only. The one that
     * can edit every other policy, and now also the one that takes a city live or offline.
     */
    public static final String SETTINGS_WRITE = "settings:write";

    /** {@code GET /users}, {@code GET /users/{id}} — staff and admin. */
    public static final String USERS_READ = "users:read";

    /**
     * {@code POST /users/staff}, {@code PATCH /users/{id}}, archive and restore — admin only. The
     * privilege-escalation surface: whoever holds this can mint an admin colleague.
     */
    public static final String USERS_WRITE = "users:write";

    /**
     * {@code GET /moderation/identity-reviews} and its detail route — the badge queue, staff and
     * admin. Split from {@link #USERS_READ}: badge review does not need the account directory.
     */
    public static final String IDENTITY_READ = "identity:read";

    /**
     * Approve or reject an identity case — admin only, the audience {@link #USERS_WRITE} already
     * gave these routes, so this narrows a grant off the privilege-escalation surface.
     */
    public static final String IDENTITY_WRITE = "identity:write";

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
     * {@code GET /admin/notes/{entityType}/{entityId}} — read what the team knows about a case.
     * Its own atom: notes span four families and are one table behind one route.
     */
    public static final String NOTES_READ = "notes:read";

    /**
     * {@code POST /admin/notes/{entityType}/{entityId}} and {@code PATCH /admin/notes/{id}} — write
     * or correct a note. Separate from {@link #NOTES_READ}: more people read a case than add to it.
     */
    public static final String NOTES_WRITE = "notes:write";

    /**
     * {@code GET /admin/conversations/{id}} — read one private chat as a moderator. Admin only and
     * separate from {@link #REPORTS_READ}. Rationale: docs/system/cross-cutting.md#back-office-permissions.
     */
    public static final String CONVERSATIONS_READ = "conversations:read";

    /** The four flatmate moderation queues. */
    public static final String FLATMATES_READ = "flatmates:read";

    /** Flatmate review, post and group-application decisions. */
    public static final String FLATMATES_WRITE = "flatmates:write";

    /** The supply console: moderation queue, verification queue, ownership claims, reviews. */
    public static final String PROPERTIES_READ = "properties:read";

    /**
     * Approve, reject, feature, flag, verify, decide an ownership claim, moderate a review. A
     * verifier holds this atom, which is also the ability to feature; there is no finer sub-scope.
     */
    public static final String PROPERTIES_WRITE = "properties:write";

    /** {@code GET /service-requests} as ops, and the service catalogue. */
    public static final String SERVICES_READ = "services:read";

    /** Claim, progress, quote and close a service request; edit the catalogue. */
    public static final String SERVICES_WRITE = "services:write";

    /** {@code GET /society-leads} — the B2B onboarding pipeline. */
    public static final String SOCIETIES_READ = "societies:read";

    /** Create a society lead and move it through its stages. */
    public static final String SOCIETIES_WRITE = "societies:write";

    /** The locality catalogue as ops sees it, drafts included. */
    public static final String LOCALITIES_READ = "localities:read";

    /** Add a locality, correct one, retire one. */
    public static final String LOCALITIES_WRITE = "localities:write";

    /**
     * The demand board: contact requests, visits and deals across the whole marketplace. Read-only
     * by design. Rationale: docs/system/cross-cutting.md#back-office-permissions.
     */
    public static final String ENQUIRIES_READ = "enquiries:read";

    /**
     * Create a listing on behalf of an owner who called the office. Write with no matching read, and
     * its own module. Rationale: docs/system/cross-cutting.md#back-office-permissions.
     */
    public static final String POSTONBEHALF_WRITE = "postOnBehalf:write";

    /**
     * One entry of the catalogue, as the admin console reads it. {@code adminOnly} is both advisory
     * to the UI and authoritative in {@link #baselineFor(String)}, so the two cannot disagree.
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
     * Every atom the server enforces, in the order a console should render them. A {@code List}
     * because the order is part of what is served: modules as they appear, read before write.
     */
    public static final List<Permission> CATALOGUE = List.of(
            ops("dashboard", READ),
            adminOnly("finance", READ),
            ops("users", READ),
            adminOnly("users", WRITE),
            ops("identity", READ),
            adminOnly("identity", WRITE),
            ops("content", READ),
            ops("content", WRITE),
            ops("properties", READ),
            ops("properties", WRITE),
            ops("postOnBehalf", WRITE),
            ops("enquiries", READ),
            ops("services", READ),
            ops("services", WRITE),
            ops("societies", READ),
            ops("societies", WRITE),
            ops("localities", READ),
            ops("localities", WRITE),
            ops("tickets", READ),
            ops("tickets", WRITE),
            ops("reports", READ),
            ops("reports", WRITE),
            ops("notes", READ),
            ops("notes", WRITE),
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

    /** Is this a name the server enforces? Rejects a write, never grants access. */
    public static boolean isKnown(String name) {
        return name != null && BY_NAME.containsKey(name);
    }

    /**
     * Everything an <em>unscoped</em> account of this role holds — the ceiling a stored document is
     * intersected with. Keyed by wire role; anything but staff or admin resolves to the empty set.
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
     * SpEL fragments for {@code @PreAuthorize}, one per atom, spelled out as constant concatenations
     * because an annotation argument must be one. Always {@code and}-ed onto a role guard, never alone.
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
    public static final String REQUIRE_IDENTITY_READ = CALL + IDENTITY_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_IDENTITY_WRITE = CALL + IDENTITY_WRITE + "')";

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
    public static final String REQUIRE_NOTES_READ = CALL + NOTES_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_NOTES_WRITE = CALL + NOTES_WRITE + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_CONVERSATIONS_READ = CALL + CONVERSATIONS_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_FLATMATES_READ = CALL + FLATMATES_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_FLATMATES_WRITE = CALL + FLATMATES_WRITE + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_PROPERTIES_READ = CALL + PROPERTIES_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_PROPERTIES_WRITE = CALL + PROPERTIES_WRITE + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_POSTONBEHALF_WRITE = CALL + POSTONBEHALF_WRITE + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_ENQUIRIES_READ = CALL + ENQUIRIES_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_SERVICES_READ = CALL + SERVICES_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_SERVICES_WRITE = CALL + SERVICES_WRITE + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_SOCIETIES_READ = CALL + SOCIETIES_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_SOCIETIES_WRITE = CALL + SOCIETIES_WRITE + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_LOCALITIES_READ = CALL + LOCALITIES_READ + "')";

    /** @see #REQUIRE_DASHBOARD_READ */
    public static final String REQUIRE_LOCALITIES_WRITE = CALL + LOCALITIES_WRITE + "')";
}
