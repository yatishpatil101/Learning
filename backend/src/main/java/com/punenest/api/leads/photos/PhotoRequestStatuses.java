package com.punenest.api.leads.photos;

/**
 * The three states a photo request can hold; the V118 CHECK rejects anything else.
 *
 * <p><strong>V117 shipped with only {@link #PENDING} and {@link #RESOLVED}, and said so in an
 * argument this class no longer makes.</strong> It reasoned that "there is nothing here for an owner
 * to decline — the request asks for photos, not for permission". That is right about permission and
 * wrong about feedback. With two states, an owner holding a listing they have no more photos of has
 * no honest move: doing nothing leaves the buyer waiting on a photo that is never coming and leaves
 * the badge permanently lit, and {@code resolved} claims a satisfaction that did not happen.
 * {@link #DECLINED} is that missing exit.
 *
 * <p>Still <strong>not</strong> the {@code pending/approved/declined} triple {@code
 * ContactRequestStatuses} uses, and the difference is worth keeping straight: there, {@code
 * approved} <em>grants</em> something (the owner's real number) and the decision is a gate. Here
 * both terminal states are pure feedback — nothing is revealed either way — so a decline costs the
 * buyer information and never access.
 */
public final class PhotoRequestStatuses {

    private PhotoRequestStatuses() {
    }

    /** Asked for, not yet acted on. The only state the owner's badge counts. */
    public static final String PENDING = "pending";

    /**
     * The owner has added photos since. The row survives resolution on purpose: the demand it
     * records ("someone wanted more of this listing") stays true after it is satisfied.
     */
    public static final String RESOLVED = "resolved";

    /**
     * The owner has no more photos to share. Terminal, and the row survives for the same reason
     * {@link #RESOLVED} does — a declined request is still evidence that someone wanted more of this
     * listing, which is the one signal this whole domain exists to collect. Counting it as demand
     * while showing the buyer a closed loop is the point.
     */
    public static final String DECLINED = "declined";

    /** The two states an owner may move a request <em>to</em>. {@link #PENDING} is not among them. */
    public static boolean isTerminal(String status) {
        return RESOLVED.equals(status) || DECLINED.equals(status);
    }
}
