package com.punenest.api.engagement.society;

/**
 * The three things a community can propose about a society.
 *
 * <p>Its own holder rather than an enum for the same reason the rest of this package uses string
 * constants: the authority is the {@code ck_society_proposal_kind} check constraint, and a Java
 * enum next to a database check is a second list free to disagree with the first.
 */
public final class SocietyProposalKinds {

    /** Builder, year, towers, units, maintenance, amenities — enriching a thin society. */
    public static final String DETAILS = "details";

    /** The resident WhatsApp group invite, screened by ops for scam links. */
    public static final String WHATSAPP = "whatsapp";

    /** A corrected map pin, dropped by somebody who has actually been to the gate. */
    public static final String LOCATION = "location";

    private SocietyProposalKinds() {
    }

    public static boolean isValid(String kind) {
        return DETAILS.equals(kind) || WHATSAPP.equals(kind) || LOCATION.equals(kind);
    }
}
