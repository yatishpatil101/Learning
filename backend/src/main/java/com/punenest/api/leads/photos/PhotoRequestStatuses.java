package com.punenest.api.leads.photos;

/**
 * The two states a photo request can hold; the V117 CHECK rejects anything else.
 *
 * <p>Deliberately not the {@code pending/approved/declined} triple that
 * {@code ContactRequestStatuses} uses. There is nothing here for an owner to decline — the request
 * asks for photos, not for permission, and an owner who does not want to add any simply does not.
 * Modelling a "declined" state would invent a decision the UI never offers and the buyer never sees.
 */
public final class PhotoRequestStatuses {

    private PhotoRequestStatuses() {
    }

    /** Asked for, not yet acted on. What the owner's badge counts. */
    public static final String PENDING = "pending";

    /**
     * The owner has added photos since. The row survives resolution on purpose: the demand it
     * records ("someone wanted more of this listing") stays true after it is satisfied.
     */
    public static final String RESOLVED = "resolved";
}
