package com.punenest.api.security;

/**
 * The back-office capability vocabulary — the third axis of authorisation, beside {@link Roles} and
 * {@link Teams}, and the one an administrator can edit at runtime.
 *
 * <p>A role says <em>what kind</em> of actor you are and a team says <em>whose work</em> you may
 * touch; a capability says <em>which act</em> you may perform inside that envelope. The values are
 * the keys of the {@code settings.permissions} document, which is an allow-list of the form
 * {@code team-or-"admin" -> [capability, …]} and is resolved by {@link PermissionMap}.
 *
 * <p><strong>These strings are stored data, not code.</strong> They are already sitting in the
 * settings document of every environment seeded from the frontend prototype, and
 * {@code R__seed_permission_map.sql} seeds them server-side. Renaming one here without a migration
 * would silently orphan whatever an admin has already written against the old name, and — because an
 * unlisted capability is denied — the rename would lock people out rather than fail loudly. Add new
 * names; do not rewrite these.
 *
 * <p><strong>Not every name in the vocabulary has a server surface, and that is recorded rather
 * than hidden.</strong> {@link #VIEW_DASHBOARD}, {@link #VIEW_SERVICE_REQUESTS} and
 * {@link #UPDATE_TICKET} each guard real routes (see the {@code REQUIRE_*} fragments below and
 * their call sites). {@link #EXPORT_CSV} guards nothing, because there is nothing to guard: the
 * platform has no export endpoint at all — CSV and PDF exports are rendered in the browser from
 * rows the client already holds (tech debt D5, {@code FinanceService}). Denying it server-side
 * would be theatre, since the data has already been delivered by the read that populated the
 * screen. It is listed here so that the gap is a written-down fact rather than something a later
 * reader has to rediscover by grepping for a constant that is never used.
 */
public final class Capabilities {

    private Capabilities() {
    }

    /**
     * Read the ops scorecard — {@code GET /admin/dashboard} and {@code GET /admin/analytics}.
     * {@code GET /admin/finance} is deliberately not covered: it is admin-only on the role axis
     * already, and what the platform earns is a different question from how the queues are doing.
     */
    public static final String VIEW_DASHBOARD = "view_dashboard";

    /**
     * See the assisted-service queue rather than only one's own requests —
     * {@code GET /service-requests} when the caller is ops.
     */
    public static final String VIEW_SERVICE_REQUESTS = "view_service_requests";

    /**
     * Work a ticket — {@code PATCH /tickets/{id}} and {@code POST /tickets/{id}/notes}. Reading the
     * board ({@code GET /tickets}) is not covered: a desk that may not act on a ticket can still
     * need to see that it exists in order to hand it on, and team scoping in {@code TicketService}
     * already decides which rows that is.
     */
    public static final String UPDATE_TICKET = "update_ticket";

    /** Declared, stored, and enforced nowhere — see the class Javadoc. */
    public static final String EXPORT_CSV = "export_csv";

    /**
     * "Everything", as an entry in an allow-list. The seeded {@code admin} bundle is {@code ["*"]},
     * which is how the document says out loud that administrators are unrestricted rather than
     * saying it by omission — an omitted key is a denial here, so silence could not have meant this.
     */
    public static final String WILDCARD = "*";

    /**
     * The name {@link PermissionMap} is registered under, so that the SpEL fragments below and the
     * {@code @Component} annotation cannot drift apart.
     */
    public static final String BEAN = "permissions";

    /** Everything before the capability name in a {@code @PreAuthorize} fragment. */
    private static final String CALL = "@" + BEAN + ".granted(authentication, '";

    /**
     * SpEL fragments for {@code @PreAuthorize}, one per enforced capability.
     *
     * <p>They are spelled out as concatenations of constants — rather than built by a helper method
     * — because an annotation argument must be a compile-time constant expression, and a method call
     * is not one. That is the same constraint that forces {@link Roles} to carry two hand-written
     * spellings of every role rather than deriving one from the other.
     *
     * <p>They exist at all so that no controller has to type the capability name as a bare literal
     * inside a longer expression, where a typo would not fail to compile — and where it would fail
     * <em>open</em>, because a capability nobody holds is only ever checked after a role guard that
     * has already passed.
     *
     * <p>Always composed with {@code and} onto an existing role check, never used alone. The map may
     * narrow what a role can do; it may not be the thing that decides whether the caller is ops.
     */
    public static final String REQUIRE_VIEW_DASHBOARD = CALL + VIEW_DASHBOARD + "')";

    /** @see #REQUIRE_VIEW_DASHBOARD */
    public static final String REQUIRE_VIEW_SERVICE_REQUESTS = CALL + VIEW_SERVICE_REQUESTS + "')";

    /** @see #REQUIRE_VIEW_DASHBOARD */
    public static final String REQUIRE_UPDATE_TICKET = CALL + UPDATE_TICKET + "')";
}
