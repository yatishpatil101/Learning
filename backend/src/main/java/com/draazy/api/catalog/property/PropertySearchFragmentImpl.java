package com.draazy.api.catalog.property;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Order;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;

/**
 * Criteria implementation of {@link PropertySearchFragment}. Found by Spring Data through the
 * {@code Impl} suffix, so the name is not cosmetic.
 */
class PropertySearchFragmentImpl implements PropertySearchFragment {

    private final EntityManager em;

    PropertySearchFragmentImpl(EntityManager em) {
        this.em = em;
    }

    @Override
    public List<Property> findPage(Specification<Property> spec, Pageable pageable) {
        CriteriaBuilder cb = em.getCriteriaBuilder();
        CriteriaQuery<Property> cq = cb.createQuery(Property.class);
        Root<Property> root = cq.from(Property.class);
        cq.select(root);
        // Applied before the sort is read, because a ranking specification restricts nothing and
        // instead calls `orderBy` on the query it is given.
        Predicate where = spec.toPredicate(root, cq, cb);
        if (where != null) {
            cq.where(where);
        }
        List<Order> orders = orders(pageable.getSort(), root, cb);
        // Guarded, not unconditional: `orderBy` with an empty list *clears* the order, which on the
        // ranked branch would throw away the ranking the specification just set.
        if (!orders.isEmpty()) {
            cq.orderBy(orders);
        }
        return em.createQuery(cq)
                .setFirstResult((int) pageable.getOffset())
                .setMaxResults(pageable.getPageSize())
                .getResultList();
    }

    @Override
    public Totals countTotals(Specification<Property> spec, Specification<Property> subset) {
        CriteriaBuilder cb = em.getCriteriaBuilder();
        CriteriaQuery<Tuple> cq = cb.createTupleQuery();
        Root<Property> root = cq.from(Property.class);
        Predicate where = spec.toPredicate(root, cq, cb);
        if (where != null) {
            cq.where(where);
        }
        // JPA has no `FILTER (WHERE ...)`, so the conditional count is spelled as a sum over a CASE.
        // Same thing to the planner, and it keeps both aggregates in one pass over one predicate.
        Predicate inSubset = subset.toPredicate(root, cq, cb);
        cq.multiselect(cb.count(root), cb.sum(cb.<Long>selectCase().when(inSubset, 1L).otherwise(0L)));
        Tuple row = em.createQuery(cq).getSingleResult();
        return new Totals(toLong(row.get(0)), toLong(row.get(1)));
    }

    private static List<Order> orders(Sort sort, Root<Property> root, CriteriaBuilder cb) {
        return sort.stream()
                .map(o -> o.isAscending() ? cb.asc(root.get(o.getProperty())) : cb.desc(root.get(o.getProperty())))
                .map(Order.class::cast)
                .toList();
    }

    /**
     * Aggregates arrive as whatever numeric type the dialect picked, and {@code SUM} over zero rows
     * is {@code NULL} - an empty search would otherwise be an NPE on the path hardest to notice.
     */
    private static long toLong(Object value) {
        return value instanceof Number n ? n.longValue() : 0L;
    }
}
