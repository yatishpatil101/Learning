package com.draazy.api.admin;

import java.math.BigDecimal;

/**
 * One locality on the pricing report: what owners are asking against what the locality is worth.
 *
 * <p><strong>Every derived figure is nullable, and that is the point of the record.</strong> The
 * browser version this replaces had no way to say "we do not know". When a locality had no listings
 * it fell back to the curated market rate, so the deviation it printed was exactly zero — and a
 * locality Draazy has never listed a single home in rendered as the most perfectly priced place in
 * Pune. An operator reading that screen could not tell a well-served locality from an empty one,
 * which is precisely the distinction the report exists to make. A null here is a measurement that
 * was not possible, and the tab is expected to render it as "no data" rather than as a number.
 *
 * <p><strong>Deliberately not {@code @JsonInclude(NON_NULL)}</strong>, unlike its sibling
 * {@code SupplyGapRow}. Omitting the key would leave the client with {@code undefined}, which is
 * one {@code ?? marketRate} away from re-introducing the same fallback on the other side of the
 * wire. An explicit {@code null} on the field is harder to paper over by accident.
 *
 * @param slug                 the locality's primary key, and the only join key the tab needs
 * @param name                 display name, as curated
 * @param marketRatePerSqft    {@code localities.rate_per_sqft} — the curated reference, maintained
 *                             by the reference seed and not inferred from listings. Null for a
 *                             locality nobody has priced yet, which is a gap in curation and worth
 *                             seeing as one
 * @param avgActualRatePerSqft mean of {@code price / area} over approved buy listings in the
 *                             locality. <strong>Null when there are none</strong> — never the market
 *                             rate, never zero
 * @param avgRent              {@code localities.avg_rent} — the curated monthly rent reference
 * @param rentalYieldPct       annualised asking rent as a percentage of the locality's capital
 *                             value, to one decimal. Null when either half is missing: no approved
 *                             rent listings with a usable area, or no curated capital rate to divide
 *                             by. A yield of "0.0" would read as a locality that earns nothing
 * @param buyCount             approved buy listings — <em>all</em> of them, including ones whose
 *                             area is missing and which therefore contributed nothing to the
 *                             average. Supply and the sample the average was drawn from are two
 *                             different questions and are not conflated here
 * @param rentCount            approved rent listings, on the same basis
 * @param totalListings        approved listings in the locality. Counted independently rather than
 *                             as {@code buyCount + rentCount}, so a deal type the report does not
 *                             break out shows up as a discrepancy instead of vanishing
 * @param demand               {@code localities.demand}, 0-100, curated. Carried so the tab can
 *                             sort by it without a second call
 */
public record PricingInsightRow(
        String slug,
        String name,
        Long marketRatePerSqft,
        Long avgActualRatePerSqft,
        Long avgRent,
        BigDecimal rentalYieldPct,
        long buyCount,
        long rentCount,
        long totalListings,
        Integer demand) {
}
