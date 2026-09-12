package com.draazy.api.engagement.society;

/**
 * The three kinds of community contribution, as stored and as sent on the wire.
 *
 * <p>A closed set, unlike a contribution's {@code category} — the categories are a per-kind list
 * the composer offers as a convenience and are free text on the wire, because a society will
 * always have a kind of tip nobody anticipated. The <em>kind</em> is different: it decides which
 * fields are required, which are forbidden, and how the card renders. An unrecognised one is a
 * 400 rather than a row that renders as a blank card.
 */
public final class SocietyContributionKinds {

    /** Prose about living here. {@code body} required. */
    public static final String TIP = "tip";

    /** A person or service the building actually uses. {@code referralName} required. */
    public static final String PICK = "pick";

    /** The place as it looks. {@code photoUrl} required. */
    public static final String PHOTO = "photo";

    private SocietyContributionKinds() {
    }

    public static boolean isValid(String kind) {
        return TIP.equals(kind) || PICK.equals(kind) || PHOTO.equals(kind);
    }
}
