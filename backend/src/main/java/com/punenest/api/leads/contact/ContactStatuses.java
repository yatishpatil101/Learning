package com.punenest.api.leads.contact;

/**
 * The five-valued contact-gate vocabulary the API returns to a viewer for one listing.
 *
 * <p>Per {@code api-standards.md} §7.1 these are {@code String} constants, not a Java {@code enum}:
 * the values are wire tokens the React client already branches on, and a constant keeps the mapping
 * between "what we store / compute" and "what we serialize" at one hop with no converter.
 *
 * <p><strong>Three of these are persisted, two are computed.</strong> {@link #PENDING},
 * {@link #APPROVED} and {@link #DECLINED} are rows in {@code contact_requests} (V4 CHECK constraint —
 * see {@link ContactRequestStatuses}). {@link #OWNER} and {@link #NONE} are derived server-side and
 * never stored: {@code owner} means "you are the listing owner, requests are moot", {@code none}
 * means "no row exists yet". Storing either would create a second, drift-prone source of truth for a
 * fact the database already knows.
 *
 * <p>Every value is traced to the {@code ContactStatus.status} enum in the OpenAPI spec.
 */
public final class ContactStatuses {

    private ContactStatuses() {
    }

    /** The viewer owns the listing — full contact, no request needed, no row created. */
    public static final String OWNER = "owner";

    /** The owner approved the request; the raw mobile may now be revealed. */
    public static final String APPROVED = "approved";

    /** A request exists and is awaiting the owner's decision. Contact stays masked. */
    public static final String PENDING = "pending";

    /** The owner declined. Terminal — contact stays masked and re-requesting does not reset it. */
    public static final String DECLINED = "declined";

    /** No request exists. The starting state for any signed-in non-owner viewer. */
    public static final String NONE = "none";

    /**
     * The reveal rule in one place (ADR-019): the raw owner mobile is emitted only at {@link #OWNER}
     * or {@link #APPROVED}.
     *
     * <p>Lives with the constants rather than in a service because it is a property <em>of</em> the
     * vocabulary — any new status must confront this method, which is exactly the review moment we
     * want. The owner's future {@code hideNumber} preference (no backing column today, see the
     * slice-3 reconciliation log) would enter here as an additional {@code &&} on the approved arm.
     */
    public static boolean revealsContact(String status) {
        return OWNER.equals(status) || APPROVED.equals(status);
    }
}
