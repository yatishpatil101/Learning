package com.draazy.api.engagement.society;

/**
 * The two kinds of noticeboard item.
 *
 * <p>String constants rather than an enum, per api-standards §7.1: the wire value is the stored
 * value, and adding a third kind should be a migration and a constant rather than a schema-breaking
 * enum ordinal.
 */
public final class SocietyBoardKinds {

    /** Dated: AGMs, tanker days, maintenance shutdowns. Requires {@code eventDate}. */
    public static final String EVENT = "event";

    /** Undated: rules, contact changes, anything with no calendar entry. */
    public static final String NOTICE = "notice";

    private SocietyBoardKinds() {
    }

    public static boolean isValid(String kind) {
        return EVENT.equals(kind) || NOTICE.equals(kind);
    }
}
