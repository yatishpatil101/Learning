package com.punenest.api.catalog.property;

/**
 * The three trust numbers for a slice of the live catalogue, as one row from one aggregate query.
 *
 * <p>Every component is a wrapper type because a JPQL constructor expression selects {@code Long},
 * and matching a primitive parameter would rely on unboxing during constructor resolution. None of
 * them is ever null: {@code count()} returns 0 over zero rows rather than nothing, so an empty
 * locality arrives as {@code (0, 0, 0)} and needs no special case above this line.
 *
 * @param totalListings   live listings in the slice — approved and unarchived
 * @param verifiedListings live listings carrying either trust badge
 * @param verifiedOwners  distinct people behind the owner-verified subset, not a count of listings
 */
public record TrustTally(
        Long totalListings,
        Long verifiedListings,
        Long verifiedOwners) {
}
