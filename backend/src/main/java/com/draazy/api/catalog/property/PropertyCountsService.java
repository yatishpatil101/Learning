package com.draazy.api.catalog.property;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PropertyCountsService {

    private final EntityManager entityManager;

    public PropertyCountsService(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Transactional(readOnly = true)
    public PropertyCountsResponse counts() {
        var cb = entityManager.getCriteriaBuilder();
        var query = cb.createTupleQuery();
        Root<Property> root = query.from(Property.class);
        Expression<String> shareType = root.<String>get("shareType");
        Expression<String> category = cb.<String>selectCase()
                .when(cb.isNotNull(shareType), shareType)
                .otherwise(root.<String>get("propertyTypeKey"));
        Expression<String> deal = root.<String>get("deal");
        Predicate visible = PropertySpecs.publicSearch(
                new PropertySearchQuery(null, null, null, null, null, null, null, null, null, null, null),
                ListingFacets.NONE).toPredicate(root, query, cb);
        query.multiselect(
                category.alias("category"),
                deal.alias("deal"),
                cb.count(root).alias("count"));
        query.where(cb.and(visible, cb.isNotNull(category)));
        query.groupBy(category, deal);
        query.orderBy(cb.asc(category), cb.asc(deal));
        List<PropertyCount> rows = entityManager.createQuery(query).getResultList().stream()
                .map(PropertyCountsService::toCount)
                .toList();
        return new PropertyCountsResponse(rows);
    }

    private static PropertyCount toCount(Tuple row) {
        return new PropertyCount(
                row.get("category", String.class),
                row.get("deal", String.class),
                row.get("count", Long.class));
    }
}
