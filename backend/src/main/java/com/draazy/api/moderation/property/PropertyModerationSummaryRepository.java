package com.draazy.api.moderation.property;

import com.draazy.api.catalog.property.Freshness;
import com.draazy.api.catalog.property.Property;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import org.springframework.stereotype.Repository;

// The moderation summary's one query. Native SQL, and a single statement rather than seven count(*) calls.
@Repository
class PropertyModerationSummaryRepository {

    private static final String SUMMARY = """
            select
              count(*) filter (where not archived)                                     as total,
              count(*) filter (where not archived and status = 'approved')             as approved,
              count(*) filter (where not archived and status = 'pending')              as pending,
              count(*) filter (where not archived and status = 'flagged')              as flagged,
              count(*) filter (where not archived and\s""" + Property.OWNER_ON_PAID_PLAN_SQL + """
            )                                                                          as featured,
              count(*) filter (where not archived and recheck_requested_at is not null
                                 and coalesce(recheck_reason, '') <> :badgeItem)       as recheck,
              count(*) filter (where archived)                                         as archived,
              count(*) filter (where not archived and ownership_requested_at is not null) as badge_requests,
              count(*) filter (where not archived and status = 'approved'
                                 and coalesce(last_confirmed_at, created_at) <= :unconfirmedBefore) as unconfirmed
            from properties
            """;

    private final EntityManager em;

    PropertyModerationSummaryRepository(EntityManager em) {
        this.em = em;
    }

    PropertyModerationSummary summary() {
        Object[] row = (Object[]) em.createNativeQuery(SUMMARY)
                .setParameter("badgeItem", Property.OWNERSHIP_REVIEW_ITEM)
                .setParameter("unconfirmedBefore", Freshness.unconfirmedBefore(Instant.now()))
                .getSingleResult();
        return new PropertyModerationSummary(
                at(row, 0), at(row, 1), at(row, 2), at(row, 3), at(row, 4), at(row, 5), at(row, 6),
                at(row, 7), at(row, 8));
    }

    // Read through Number so the mapping ignores Long vs BigInteger driver paths.
    private static long at(Object[] row, int index) {
        Object value = row[index];
        return value instanceof Number n ? n.longValue() : 0L;
    }
}
