package com.draazy.api.catalog.property;

import java.util.Set;

/**
 * The moderation lifecycle values of {@code properties.status}.
 *
 * <p>Mirrors the OpenAPI {@code PropertyStatus} enum — the contract is the source of truth, these are
 * its Java spelling. The values are persisted verbatim in the {@code status} column and returned
 * verbatim to the client, so they are simultaneously a DB value and API surface: changing one is a
 * migration plus a breaking contract change, never a rename.
 *
 * <p><strong>Why constants and not a Java {@code enum}.</strong> The column, the DTO records, and the
 * search filter all carry {@code String}, matching the contract's open-ended string enum. Promoting
 * this to a real enum means a converter, DTO signature changes, and a migration story for any value
 * the DB holds that the enum does not — worth doing when the moderation workflow grows behaviour, but
 * it buys nothing today beyond what a typo-proof constant already gives. Kept as constants
 * deliberately.
 *
 * <p><strong>Trust invariant.</strong> {@link #APPROVED} is the public-visibility floor: only an
 * approved, non-archived listing is ever shown to an anonymous caller, and only moderation may set
 * it. A listing is born {@link #PENDING} and returns there whenever a foundation field changes.
 */
public final class PropertyStatus {

    private PropertyStatus() {
    }

    /** Awaiting moderation. The birth state, and the state a foundation-field edit reverts to. */
    public static final String PENDING = "pending";

    /** Live and publicly visible. Set by moderation only — never by an owner's own edit. */
    public static final String APPROVED = "approved";

    /** Moderation refused the listing. */
    public static final String REJECTED = "rejected";

    /** Flagged for review (e.g. a user report). Not publicly visible. */
    public static final String FLAGGED = "flagged";

    /** Soft-deleted by the owner. Retained for audit; never hard-deleted. */
    public static final String ARCHIVED = "archived";

    /**
     * Terminal: the sale closed (D110). Drops out of the approved-floored search but stays
     * reachable by direct link, badged. Set by {@code DealService} on a buy-deal close; reverted to
     * {@link #APPROVED} on reopen. Never set by an owner's own edit.
     */
    public static final String SOLD = "sold";

    /** Terminal: the rental closed (D110). The rent-deal counterpart of {@link #SOLD}. */
    public static final String RENTED = "rented";

    /**
     * The statuses a direct link resolves on — the query-side spelling of
     * {@link Property#isDirectlyReachable()}.
     *
     * <p>Exists so a public read that only needs to answer 404-or-not can apply the visibility floor
     * without hydrating the row. Kept next to the constants it is built from, because the failure
     * mode is the two drifting apart: a floor that is enforced in one of two places is not a floor,
     * and the endpoint that skips it becomes an existence oracle for listings moderation refused.
     */
    public static final Set<String> DIRECTLY_REACHABLE = Set.of(APPROVED, SOLD, RENTED);

    /**
     * The statuses that occupy one of the owner's freemium listing slots.
     *
     * <p>The free tier is one listing <em>at a time</em>, not one listing ever, so this is
     * deliberately not "every row this owner has posted". {@link #ARCHIVED} frees the slot, which is
     * what makes taking a listing down a real alternative to paying. So does {@link #REJECTED}: a
     * listing moderation refused is not occupying anything the owner can use, and charging them a
     * slot for it would mean a rejection permanently costs a free-tier owner their whole allowance.
     *
     * <p>{@link #PENDING} does count, because it is on its way live and the alternative is a queue
     * of ten drafts that all publish the moment ops clear them. {@link #SOLD} and {@link #RENTED}
     * count for the same reason they stay reachable by direct link — they are still the owner's
     * published record of that property, and they can be archived when they are done with it.
     */
    public static final Set<String> OCCUPIES_LISTING_SLOT =
            Set.of(PENDING, APPROVED, FLAGGED, SOLD, RENTED);
}
