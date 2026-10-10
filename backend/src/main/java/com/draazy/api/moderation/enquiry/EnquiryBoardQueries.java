package com.draazy.api.moderation.enquiry;

import com.draazy.api.deals.deal.DealStatuses;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Repository;

/** Optional filters are always bound (a flag plus a neutral value), never as nulls,
 * so PostgreSQL never has to guess a parameter's type. */
@Repository
class EnquiryBoardQueries {

    /** {@code since} is never null (epoch when unfiltered); {@code mobilePrefix} is a whole normalised number
     *  or "-", wildcard-free so {@code like} is equality. */
    record Filter(String status, String deal, String contains, String mobilePrefix, Instant since) {

        boolean searching() {
            return !contains.isEmpty();
        }
    }

    private static final String FROM_ENQUIRY = """
            from ContactRequest x
            left join Property p on p.id = x.propertyId
            left join User u on u.id = x.requesterId
            where x.createdAt >= :since
              and (:anyStatus = true or x.status = :status)
              and (:searching = false
                   or lower(p.title) like :contains escape '\\'
                   or lower(u.name) like :contains escape '\\'
                   or u.mobile like :mobilePrefix escape '\\')
            """;

    private static final String FROM_VISIT = """
            from Visit x
            left join Property p on p.id = x.propertyId
            left join User u on u.id = x.visitorId
            where x.createdAt >= :since
              and (:anyStatus = true or x.status = :status)
              and (:searching = false
                   or lower(p.title) like :contains escape '\\'
                   or lower(u.name) like :contains escape '\\'
                   or u.mobile like :mobilePrefix escape '\\')
            """;

    private static final String FROM_DEAL = """
            from Deal x
            left join Property p on p.id = x.propertyId
            left join User u on u.id = x.counterpartyId
            where coalesce(x.closedAt, x.createdAt) >= :since
              and (:anyStatus = true or x.status = :status)
              and (:anyDeal = true or x.deal = :deal)
              and (:searching = false
                   or lower(p.title) like :contains escape '\\'
                   or lower(u.name) like :contains escape '\\'
                   or x.counterpartyMobile like :mobilePrefix escape '\\'
                   or u.mobile like :mobilePrefix escape '\\')
            """;

    private static final String ORDER = " order by x.createdAt desc, x.id";

    private final EntityManager em;

    EnquiryBoardQueries(EntityManager em) {
        this.em = em;
    }

    Page<Object[]> enquiries(Filter f, Pageable pageable) {
        return page("select x.id, x.propertyId, p.title, p.localitySlug, u.name, u.mobile, x.status, x.createdAt "
                + FROM_ENQUIRY + ORDER, "select count(x) " + FROM_ENQUIRY, f, false, pageable);
    }

    Page<Object[]> visits(Filter f, Pageable pageable) {
        return page("select x.id, x.propertyId, p.title, p.localitySlug, u.name, u.mobile, x.slot, x.mode, "
                + "x.status, x.createdAt " + FROM_VISIT + ORDER, "select count(x) " + FROM_VISIT, f, false, pageable);
    }

    Page<Object[]> deals(Filter f, Pageable pageable) {
        return page("select x.id, x.propertyId, p.title, p.localitySlug, x.deal, u.name, x.counterpartyMobile, "
                + "u.mobile, x.agreedPrice, x.status, x.closedAt, x.createdAt " + FROM_DEAL + ORDER,
                "select count(x) " + FROM_DEAL, f, true, pageable);
    }

    Map<String, Long> countsByStatus(String entity) {
        return tally("select x.status, count(x) from " + entity + " x group by x.status");
    }

    Map<String, Long> dealTypeCounts() {
        return tally("select x.deal, count(x) from Deal x group by x.deal");
    }

    long dealValue() {
        return ((Number) em.createQuery("select coalesce(sum(x.agreedPrice), 0) from Deal x").getSingleResult())
                .longValue();
    }

    List<Object[]> enquiriesByLocality(Instant since) {
        return em.createQuery("""
                select p.localitySlug, count(x) from ContactRequest x
                left join Property p on p.id = x.propertyId
                where x.createdAt >= :since group by p.localitySlug
                """, Object[].class).setParameter("since", since).getResultList();
    }

    List<Object[]> visitsByLocality(Instant since) {
        return em.createQuery("""
                select p.localitySlug, count(x) from Visit x
                left join Property p on p.id = x.propertyId
                where x.slot >= :since group by p.localitySlug
                """, Object[].class).setParameter("since", since).getResultList();
    }

    List<Object[]> closedDealsByLocality(Instant since, String deal) {
        return em.createQuery("""
                select p.localitySlug, count(x), coalesce(sum(x.agreedPrice), 0) from Deal x
                left join Property p on p.id = x.propertyId
                where x.status = :closed and coalesce(x.closedAt, x.createdAt) >= :since
                  and (:anyDeal = true or x.deal = :deal)
                group by p.localitySlug
                """, Object[].class)
                .setParameter("closed", DealStatuses.CLOSED)
                .setParameter("since", since)
                .setParameter("anyDeal", deal.isEmpty())
                .setParameter("deal", deal)
                .getResultList();
    }

    private Map<String, Long> tally(String hql) {
        Map<String, Long> out = new java.util.LinkedHashMap<>();
        for (Object[] row : em.createQuery(hql, Object[].class).getResultList()) {
            out.put((String) row[0], ((Number) row[1]).longValue());
        }
        return out;
    }

    private Page<Object[]> page(String select, String count, Filter f, boolean deals, Pageable pageable) {
        Function<String, Query> bound = hql -> {
            Query q = em.createQuery(hql);
            q.setParameter("since", f.since());
            q.setParameter("anyStatus", f.status().isEmpty());
            q.setParameter("status", f.status());
            q.setParameter("searching", f.searching());
            q.setParameter("contains", f.contains());
            q.setParameter("mobilePrefix", f.mobilePrefix());
            if (deals) {
                q.setParameter("anyDeal", f.deal().isEmpty());
                q.setParameter("deal", f.deal());
            }
            return q;
        };
        long total = ((Number) bound.apply(count).getSingleResult()).longValue();
        @SuppressWarnings("unchecked")
        List<Object[]> rows = bound.apply(select)
                .setFirstResult((int) pageable.getOffset())
                .setMaxResults(pageable.getPageSize())
                .getResultList();
        return new PageImpl<>(rows, pageable, total);
    }
}
