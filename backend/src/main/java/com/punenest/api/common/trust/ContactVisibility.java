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

    /** Emit the raw mobile. Only ever the result of gate status {@code owner} or {@code approved}. */
    REVEALED
}
