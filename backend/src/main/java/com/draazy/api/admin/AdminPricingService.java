package com.draazy.api.admin;

import com.draazy.api.catalog.property.PropertyStatus;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The pricing report: asking prices against each locality's curated market rate.
 *
 * <p><strong>One query over the catalogue, not one per locality.</strong> A locality-at-a-time loop
 * is the obvious shape and the wrong one — it is a scan of {@code properties} per row of
 * {@code localities}, on a page whose whole purpose is to compare localities against each other, so
 * the cost grows exactly as the report gets more useful. The aggregate below is a single grouped
 * left join and returns the same answer in one round trip.
 *
 * <p><strong>Listings with no usable area are excluded from the averages, not defaulted.</strong>
 * {@code properties.area} is nullable, and a listing whose owner skipped it is not a listing priced
 * at zero rupees a square foot. Coalescing it — or guarding the division and substituting 0 — would
 * drag the locality's average toward zero in proportion to how many owners left the field blank,
 * which is a data-entry statistic masquerading as a market one. They are filtered in SQL so they
 * never enter the mean, while still being counted as supply.
 *
 * <p><strong>Absence is reported as absence.</strong> Every aggregate here can legitimately have no
 * rows behind it, and each one returns null when it does. See {@link PricingInsightRow} for what the
 * browser version did instead and why it made the report unreadable.
 */
@Service
public class AdminPricingService {

    /**
     * The report, in one statement.
     *
     * <p>{@code archived = false} joins {@code status = 'approved'} because that pair is what the
     * rest of the platform means by a live listing (see {@code PropertyRepository}); approving a
     * listing and then soft-deleting it leaves the status untouched, so status alone would price a
     * locality partly on homes that are no longer offered.
     *
     * <p>The {@code filter} clauses do the deal split inside a single pass. {@code p.area > 0} is
     * null-safe by construction — {@code null > 0} is unknown, so a missing area fails the filter
     * exactly as a zero one does, and neither reaches the division.
     *
     * <p>{@code count(*) filter (where p.deal = ...)} is safe under the left join: the padded row of
     * a locality with no listings has a null {@code deal}, which no filter matches, so an empty
     * locality counts zero rather than one. {@code count(p.id)} is used for the total for the same
     * reason — {@code count(*)} there would report 1.
     *
     * <p>Yield is average monthly asking rent per square foot, annualised, over the curated capital
     * rate for the same square foot. Both sides are per-sqft so the areas cancel, which is what lets
     * a two-bedroom and a studio in the same locality be averaged together at all. The mean is taken
     * over listings rather than over rupees, so one very large flat cannot speak for the locality.
     * {@code nullif(..., 0)} is the guard on the only divisor that is not already filtered — a
     * curated rate of zero is a curation bug, and dividing by it would report an infinite yield.
     */
    private static final String PRICING_INSIGHTS = """
            select l.slug,
                   l.name,
                   round(l.rate_per_sqft)                            as market_rate_per_sqft,
                   round(avg(p.price / p.area) filter (
                       where p.deal = 'buy' and p.area > 0))         as avg_actual_rate_per_sqft,
                   l.avg_rent,
                   round(avg(p.price / p.area) filter (
                       where p.deal = 'rent' and p.area > 0)
                       * 12 / nullif(l.rate_per_sqft, 0) * 100, 1)   as rental_yield_pct,
                   count(*) filter (where p.deal = 'buy')            as buy_count,
                   count(*) filter (where p.deal = 'rent')           as rent_count,
                   count(p.id)                                       as total_listings,
                   l.demand
              from localities l
              left join properties p
                on p.locality_slug = l.slug
               and p.status = :status
               and p.archived = false
             where l.active = true
             group by l.slug, l.name, l.rate_per_sqft, l.avg_rent, l.demand
             order by l.name
            """;

    private final EntityManager em;

    public AdminPricingService(EntityManager em) {
        this.em = em;
    }

    /**
     * @return one row per active locality, by name. A locality with no listings is present with null
     *         averages rather than absent: "we have nothing here" is the report's most actionable
     *         finding, and dropping the row would hide it behind the localities that are doing fine
     */
    @SuppressWarnings("unchecked")
    @Transactional(readOnly = true)
    public List<PricingInsightRow> report() {
        List<Object[]> rows = em.createNativeQuery(PRICING_INSIGHTS)
                .setParameter("status", PropertyStatus.APPROVED)
                .getResultList();

        List<PricingInsightRow> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            out.add(new PricingInsightRow(
                    (String) r[0],
                    (String) r[1],
                    rupees(r[2]),
                    rupees(r[3]),
                    rupees(r[4]),
                    (BigDecimal) r[5],
                    count(r[6]),
                    count(r[7]),
                    count(r[8]),
                    (Integer) r[9]));
        }
        return out;
    }

    /** Whole rupees, preserving null. Rounding happens in SQL; this only narrows the type. */
    private static Long rupees(Object value) {
        return value == null ? null : ((Number) value).longValue();
    }

    /** A count is never null — {@code count()} returns 0 for an empty group. */
    private static long count(Object value) {
        return ((Number) value).longValue();
    }
}
