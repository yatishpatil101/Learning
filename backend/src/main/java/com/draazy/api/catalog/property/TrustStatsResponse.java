package com.draazy.api.catalog.property;

/**
 * The contract's {@code TrustStats} — how much of the live catalogue carries a trust badge.
 *
 * <p>Public, because this is the number a visitor is shown before there is any reason to sign in:
 * it is the homepage's answer to "why should I believe these listings?". It says nothing about any
 * individual listing or person, only how many there are, which is what makes it safe to hand to an
 * anonymous caller.
 *
 * <p><strong>Every field is a plain {@code long}, and zero is a real answer.</strong> There is no
 * null here and no {@code NON_NULL} omission, unlike a rating average: "how many" always has an
 * answer, and a locality nobody has listed in yet has genuinely zero verified listings rather than
 * an unknown number of them.
 *
 * @param verifiedListings live listings carrying the owner-verified or ownership-verified badge
 * @param totalListings    live listings in the same slice — the denominator, always {@code >=}
 *     {@code verifiedListings}
 * @param verifiedOwners   distinct owner-verified people behind those listings, not a listing count
 */
public record TrustStatsResponse(
        long verifiedListings,
        long totalListings,
        long verifiedOwners) {
}
