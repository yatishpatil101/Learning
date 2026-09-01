package com.punenest.api.common.trust;

/**
 * Whether a projection may carry a raw owner mobile, or must mask it.
 *
 * <p>A two-valued type rather than a {@code boolean} on purpose: it travels through MapStruct as a
 * {@code @Context} argument and appears in mapper signatures, where {@code toResponse(p, true)} would
 * be unreadable and — being the security decision on this surface — easy to invert by accident.
 *
 * <p>This is the <em>rendered</em> outcome of the gate, not the gate state itself. The five-valued
 * gate vocabulary ({@code owner|approved|pending|declined|none}) belongs to the contacts feature;
 * only the collapsed reveal/mask decision crosses into the shared kernel, so the catalogue never
 * needs to know what a contact request is.
 */
public enum ContactVisibility {

    /** Emit the contract's masked form ({@code 98XXXXX210}). The default for every caller. */
    MASKED,

    /**
     * Emit the raw mobile.
     *
     * <p>Reached two ways, and they are not the same kind of permission. A counterparty gets here by
     * passing the contact gate — status {@code owner} or {@code approved} — which is the owner's own
     * decision about one seeker. The back-office moderation desk gets here by holding
     * {@code properties:read}, which is the platform's decision about an employee, and applies to
     * every listing in the queue at once.
     *
     * <p>The second route was added deliberately after the desk was built masked. A moderator whose
     * job is to ring the owner of a stuck listing will obtain the number regardless; masking it here
     * only moved that lookup somewhere with no audit trail. The disclosure is the same either way —
     * what changed is that the platform now records it.
     */
    REVEALED
}
