package com.draazy.api.admin;

import com.draazy.api.catalog.property.PropertyStatus;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Averages are null under {@link #MIN_SAMPLE} flats: one or two listings are an owner's opinion, not a locality's price. */
@Service
public class AdminPricingService {

    private static final String PRICING_INSIGHTS = """
            select l.slug,
                   l.name,
                   case when count(*) filter (where p.deal = 'buy' and p.property_type_key = 'flat'
                                                and p.area > 0) >= :minSample
                        then round(avg(p.price / p.area) filter (
                            where p.deal = 'buy' and p.property_type_key = 'flat' and p.area > 0))
                   end                                               as avg_actual_rate_per_sqft,
                   case when count(*) filter (where p.deal = 'rent' and p.property_type_key = 'flat')
                                 >= :minSample
                        then round(avg(p.price) filter (
                            where p.deal = 'rent' and p.property_type_key = 'flat'))
                   end                                               as avg_rent,
                   case when count(*) filter (where p.deal = 'rent' and p.property_type_key = 'flat'
                                                and p.area > 0) >= :minSample
                         and count(*) filter (where p.deal = 'buy' and p.property_type_key = 'flat'
                                                and p.area > 0) >= :minSample
                        then round(avg(p.price / p.area) filter (
                            where p.deal = 'rent' and p.property_type_key = 'flat' and p.area > 0)
                            * 12 / nullif(avg(p.price / p.area) filter (
                            where p.deal = 'buy' and p.property_type_key = 'flat' and p.area > 0), 0) * 100, 1)
                   end                                               as rental_yield_pct,
                   count(*) filter (where p.deal = 'buy')            as buy_count,
                   count(*) filter (where p.deal = 'rent')           as rent_count,
                   count(p.id)                                       as total_listings
              from localities l
              left join properties p
                on p.locality_slug = l.slug
               and p.status = :status
               and p.archived = false
             where l.archived_at is null or p.id is not null
             group by l.slug, l.name
             order by l.name
            """;

    static final int MIN_SAMPLE = 3;

    private final EntityManager em;

    public AdminPricingService(EntityManager em) {
        this.em = em;
    }

    @SuppressWarnings("unchecked")
    @Transactional(readOnly = true)
    public List<PricingInsightRow> report() {
        List<Object[]> rows = em.createNativeQuery(PRICING_INSIGHTS)
                .setParameter("status", PropertyStatus.APPROVED)
                .setParameter("minSample", MIN_SAMPLE)
                .getResultList();

        List<PricingInsightRow> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            out.add(new PricingInsightRow(
                    (String) r[0],
                    (String) r[1],
                    rupees(r[2]),
                    rupees(r[3]),
                    (BigDecimal) r[4],
                    count(r[5]),
                    count(r[6]),
                    count(r[7])));
        }
        return out;
    }

    private static Long rupees(Object value) {
        return value == null ? null : ((Number) value).longValue();
    }

    private static long count(Object value) {
        return ((Number) value).longValue();
    }
}