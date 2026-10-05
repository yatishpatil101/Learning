package com.draazy.api.security;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

// Per-account permissions subtract from the compiled-in role baseline.
// Rationale: docs/system/cross-cutting.md#back-office-permissions.
public final class BackOfficePermissions {

    private BackOfficePermissions() {
    }

    public static final String READ = "read";

    public static final String WRITE = "write";

    // Must match the bean name used by the SpEL fragments below.
    public static final String BEAN = "accountPermissions";

    public static final String DASHBOARD_READ = "dashboard:read";

    public static final String ANALYTICS_READ = "analytics:read";

    public static final String FINANCE_READ = "finance:read";

    public static final String SETTINGS_READ = "settings:read";

    public static final String SETTINGS_WRITE = "settings:write";

    public static final String USERS_READ = "users:read";

    public static final String USERS_WRITE = "users:write";

    public static final String IDENTITY_READ = "identity:read";

    public static final String IDENTITY_WRITE = "identity:write";

    /** Staff activity for managers/admins; the full audit log stays route-guarded admin-only. */
    public static final String AUDIT_READ = "audit:read";

    public static final String CONTENT_READ = "content:read";

    public static final String CONTENT_WRITE = "content:write";

    public static final String TICKETS_READ = "tickets:read";

    public static final String TICKETS_WRITE = "tickets:write";

    public static final String REPORTS_READ = "reports:read";

    public static final String REPORTS_WRITE = "reports:write";

    public static final String NOTES_READ = "notes:read";

    // Separate from `#NOTES_READ`: more people read a case than add to it.
    public static final String NOTES_WRITE = "notes:write";

    // Admin only and separate from `#REPORTS_READ`.
    // Rationale: docs/system/cross-cutting.md#back-office-permissions.
    public static final String FLATMATES_READ = "flatmates:read";

    public static final String FLATMATES_WRITE = "flatmates:write";

    public static final String PROPERTIES_READ = "properties:read";

    public static final String PROPERTIES_VERIFY = "properties:verify";

    public static final String PROPERTIES_MODERATE = "properties:moderate";

    public static final String SERVICES_READ = "services:read";

    public static final String SERVICES_WRITE = "services:write";

    public static final String REGISTRATIONS_WRITE = "registrations:write";

    public static final String SOCIETIES_READ = "societies:read";

    public static final String SOCIETIES_WRITE = "societies:write";

    // Rationale: docs/system/cross-cutting.md#back-office-permissions.
    public static final String ENQUIRIES_READ = "enquiries:read";

    public static final String POSTONBEHALF_WRITE = "postOnBehalf:write";

    // `adminOnly` is both advisory to the UI and authoritative in `#baselineFor(String)`, so the two cannot disagree.
    public record Permission(String name, String module, String action, boolean adminOnly) {
    }

    private static Permission ops(String module, String action) {
        return new Permission(module + ":" + action, module, action, false);
    }

    private static Permission adminOnly(String module, String action) {
        return new Permission(module + ":" + action, module, action, true);
    }

    // Every atom the server enforces, in the order a console should render them.
    // A `List` because the order is part of what is served: modules as they appear, read before write.
    public static final List<Permission> CATALOGUE = List.of(
            ops("dashboard", READ),
            ops("analytics", READ),
            adminOnly("finance", READ),
            ops("users", READ),
            adminOnly("users", WRITE),
            ops("identity", READ),
            ops("identity", WRITE),
            ops("content", READ),
            ops("content", WRITE),
            ops("properties", READ),
            ops("properties", "verify"),
            ops("properties", "moderate"),
            ops("postOnBehalf", WRITE),
            ops("enquiries", READ),
            ops("services", READ),
            ops("services", WRITE),
            ops("registrations", WRITE),
            ops("societies", READ),
            ops("societies", WRITE),
            ops("tickets", READ),
            ops("tickets", WRITE),
            ops("reports", READ),
            ops("reports", WRITE),
            ops("notes", READ),
            ops("notes", WRITE),
            ops("flatmates", READ),
            ops("flatmates", WRITE),
            adminOnly("audit", READ),
            adminOnly("settings", READ),
            adminOnly("settings", WRITE));

    private static final Map<String, Permission> BY_NAME = byName();
    private static final Set<String> ADMIN_BASELINE = baseline(true);
    private static final Set<String> MANAGER_BASELINE = managerBaseline();
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

    private static Set<String> managerBaseline() {
        Set<String> names = new LinkedHashSet<>(baseline(false));
        names.add(USERS_WRITE);
        names.add(AUDIT_READ);
        return Set.copyOf(names);
    }

    public static boolean isKnown(String name) {
        return name != null && BY_NAME.containsKey(name);
    }

    // Everything an unscoped account of this role holds — the ceiling a stored document is intersected with.
    // Keyed by wire role; anything but staff, manager or admin resolves to the empty set.
    public static Set<String> baselineFor(String wireRole) {
        if (Roles.Wire.ADMIN.equals(wireRole)) {
            return ADMIN_BASELINE;
        }
        if (Roles.Wire.MANAGER.equals(wireRole)) {
            return MANAGER_BASELINE;
        }
        if (Roles.Wire.STAFF.equals(wireRole)) {
            return STAFF_BASELINE;
        }
        return Set.of();
    }

    /** Everything before the atom in a {@code @PreAuthorize} fragment. */
    private static final String CALL = "@" + BEAN + ".granted(authentication, '";

    // Annotation arguments must be constants, so each permission atom is spelled out.
    // Always combine these with a role guard; never use them alone.
    public static final String REQUIRE_DASHBOARD_READ = CALL + DASHBOARD_READ + "')";

    public static final String REQUIRE_ANALYTICS_READ = CALL + ANALYTICS_READ + "')";

    public static final String REQUIRE_FINANCE_READ = CALL + FINANCE_READ + "')";

    public static final String REQUIRE_SETTINGS_READ = CALL + SETTINGS_READ + "')";

    public static final String REQUIRE_SETTINGS_WRITE = CALL + SETTINGS_WRITE + "')";

    public static final String REQUIRE_USERS_READ = CALL + USERS_READ + "')";

    public static final String REQUIRE_USERS_WRITE = CALL + USERS_WRITE + "')";

    public static final String REQUIRE_IDENTITY_READ = CALL + IDENTITY_READ + "')";

    public static final String REQUIRE_IDENTITY_WRITE = CALL + IDENTITY_WRITE + "')";

    public static final String REQUIRE_AUDIT_READ = CALL + AUDIT_READ + "')";

    public static final String REQUIRE_CONTENT_READ = CALL + CONTENT_READ + "')";

    public static final String REQUIRE_CONTENT_WRITE = CALL + CONTENT_WRITE + "')";

    public static final String REQUIRE_TICKETS_READ = CALL + TICKETS_READ + "')";

    public static final String REQUIRE_TICKETS_WRITE = CALL + TICKETS_WRITE + "')";

    public static final String REQUIRE_REPORTS_READ = CALL + REPORTS_READ + "')";

    public static final String REQUIRE_REPORTS_WRITE = CALL + REPORTS_WRITE + "')";

    public static final String REQUIRE_NOTES_READ = CALL + NOTES_READ + "')";

    public static final String REQUIRE_NOTES_WRITE = CALL + NOTES_WRITE + "')";

    public static final String REQUIRE_FLATMATES_READ = CALL + FLATMATES_READ + "')";

    public static final String REQUIRE_FLATMATES_WRITE = CALL + FLATMATES_WRITE + "')";

    public static final String REQUIRE_PROPERTIES_READ = CALL + PROPERTIES_READ + "')";

    public static final String REQUIRE_PROPERTIES_VERIFY = CALL + PROPERTIES_VERIFY + "')";

    public static final String REQUIRE_PROPERTIES_MODERATE = CALL + PROPERTIES_MODERATE + "')";

    public static final String REQUIRE_POSTONBEHALF_WRITE = CALL + POSTONBEHALF_WRITE + "')";

    public static final String REQUIRE_ENQUIRIES_READ = CALL + ENQUIRIES_READ + "')";

    public static final String REQUIRE_SERVICES_READ = CALL + SERVICES_READ + "')";

    public static final String REQUIRE_SERVICES_WRITE = CALL + SERVICES_WRITE + "')";

    public static final String REQUIRE_REGISTRATIONS_WRITE = CALL + REGISTRATIONS_WRITE + "')";

    public static final String REQUIRE_SOCIETIES_READ = CALL + SOCIETIES_READ + "')";

    public static final String REQUIRE_SOCIETIES_WRITE = CALL + SOCIETIES_WRITE + "')";
}
