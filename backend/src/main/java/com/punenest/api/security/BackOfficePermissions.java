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
     *
     * <p>Staff and admin, and <strong>deliberately not folded into the atom of the queue the note
     * hangs off</strong>. Notes span four families; granting them through {@code properties:read}
     * would mean an account cleared to browse listings could also read every staff observation
     * about every person, because the notes are one table and the read would be one route.
     */
    public static final String NOTES_READ = "notes:read";

    /**
     * {@code POST /admin/notes/{entityType}/{entityId}} and {@code PATCH /admin/notes/{id}} — write
     * or correct a note.
     *
     * <p>Separate from {@link #NOTES_READ} for the reason {@link #REPORTS_READ} and
     * {@link #REPORTS_WRITE} are separate: reading a case file and adding to it are different jobs,
     * and more people do the first than should do the second.
     */
    public static final String NOTES_WRITE = "notes:write";

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

    /** The supply console: moderation queue, verification queue, ownership claims, reviews. */
    public static final String PROPERTIES_READ = "properties:read";

    /**
     * Approve, reject, feature, flag, verify, decide an ownership claim, moderate a review.
     *
     * <p>Replaces the console-only {@code properties:verify} that {@code V61} deleted. That name
     * tried to express "may verify but may not feature", which is a sub-scope of one module
     * ({@code PropertyVerificationController} vs the rest of the supply console) that this
     * vocabulary has no way to say. Rather than reintroduce a third action alongside read and write
     * for one module's benefit, the sub-scope is dropped: a verifier holds
     * {@code properties:write}, which is also the ability to feature. Recorded as an accepted
     * narrowing in the migration plan, not silently.
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
     * The demand board: contact requests, visits and deals across the whole marketplace.
     *
     * <p><strong>There is no {@code enquiries:write}, and that is the product decision, not an
     * omission.</strong> Every row this board shows belongs to two other people — a contact request
     * is the owner's to approve, a visit is the participants' to confirm or move, a deal is the
     * owner's to close. Ops watching demand health is a different job from ops answering on
     * somebody's behalf, and the console's old "mark responded" / "close" buttons wrote the owner's
     * decision field with the operator's opinion. A write atom here would have to name a route that
     * does that, so there is neither. What the console offers instead is an internal note against
     * the row under {@code notes:write} — the operator's opinion recorded as the operator's opinion,
     * beside the row rather than inside it.
     *
     * <p><strong>Nor is there an {@code enquiries:reveal}</strong>, and that is also deliberate.
     * The detail routes that unmask one contact number ({@code GET /admin/enquiries/&#123;id&#125;}
     * and siblings, D25) are guarded by this same atom with the <em>role</em> term raised to
     * {@code admin}, the way {@code users:read} guards both the masked directory and the audited
     * user detail. Unmasking is not a separate capability so much as a narrower audience for this
     * one, and every atom in this catalogue is a checkbox an administrator has to form an opinion
     * about — a grid that grows a row per shade of the same permission stops being read.
     */
    public static final String ENQUIRIES_READ = "enquiries:read";

    /**
     * Create a listing on behalf of an owner who called the office.
     *
     * <p><strong>Write with no matching read, uniquely in this catalogue.</strong> The module is a
     * single form with nothing to list; a {@code postOnBehalf:read} would be a name that guards no
     * route, which is exactly what this file refuses to hold. The console gates the nav entry on
     * the write atom instead.
     *
     * <p>Deliberately its own module rather than {@code properties:write}. This route names another
     * user as the owner of what it creates, which is a different power from editing supply that
     * already exists — an operator who can post as anyone can also manufacture a listing under a
     * consumer's name. Separating it lets an ops lead grant the supply console without it.
     *
     * <p>Spelled {@code POSTONBEHALF} rather than {@code POST_ON_BEHALF} because
     * {@code AccountPermissionsGuardTest} derives the {@code REQUIRE_} fragment mechanically from
     * the wire name — underscore for the colon, then uppercase — and a hand-prettified constant is
     * a name the sweep cannot find. An atom that reads slightly worse is a cheap price for one the
     * guard can still prove is enforced. The only camelCase module in the catalogue, so the only
     * place the two spellings diverge.
     */
    public static final String POSTONBEHALF_WRITE = "postOnBehalf:write";

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
