package com.draazy.api.catalog.property;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The property page's "similar homes": ranked here so the page receives three cards, not two hundred rows. */
@Service
public class SimilarListings {

    static final int LIMIT = 3;
    private static final int POOL = 100;
    private static final double RADIUS_KM = 6;
    private static final double PRICE_LOW = 0.6;
    private static final double PRICE_HIGH = 1.6;
    private static final double EARTH_RADIUS_KM = 6371.0;

    private final PropertyRepository properties;
    private final PropertyService propertyService;

    public SimilarListings(PropertyRepository properties, PropertyService propertyService) {
        this.properties = properties;
        this.propertyService = propertyService;
    }

    public record Query(String deal, String locality, BigDecimal bhk, Long price, Double lat, Double lng,
            String exclude) {
    }

    public record Ranked(Property property, double km) {
    }

    /** Same deal; nearby, similar size and price first, then nearest within the radius, then nearest at all. */
    @Transactional(readOnly = true)
    public List<Ranked> near(Query q) {
        List<Property> pool = q.locality() == null ? candidates(q, null) : candidates(q, q.locality());
        if (q.locality() != null && pool.size() < LIMIT) {
            pool = candidates(q, null);
        }
        List<Ranked> all = pool.stream().map(p -> new Ranked(p, km(q, p))).toList();
        Comparator<Ranked> byKm = Comparator.comparingDouble(Ranked::km);
        List<Ranked> picked = new ArrayList<>();
        fill(picked, all.stream().filter(r -> r.km() <= RADIUS_KM && bhkOk(q, r) && priceOk(q, r)),
                byKm.thenComparingLong(r -> Math.abs(orZero(r.property().getPrice()) - orZero(q.price()))));
        fill(picked, all.stream().filter(r -> r.km() <= RADIUS_KM), byKm);
        fill(picked, all.stream(), byKm);
        return picked;
    }

    private List<Property> candidates(Query q, String locality) {
        PropertySearchQuery filters = new PropertySearchQuery(
                q.deal(), null, locality, null, null, null, null, null, null, null, null);
        return properties.findPage(PropertySpecs.publicSearch(filters, ListingFacets.NONE,
                        propertyService.localityCenter(locality)).and(PropertySpecs.newestFirst()),
                PageRequest.of(0, POOL)).stream()
                .filter(p -> !p.getId().toString().equals(q.exclude()) && !String.valueOf(p.getSlug()).equals(q.exclude()))
                .toList();
    }

    private static void fill(List<Ranked> picked, Stream<Ranked> from, Comparator<Ranked> order) {
        from.sorted(order).forEach(r -> {
            if (picked.size() < LIMIT && !picked.contains(r)) {
                picked.add(r);
            }
        });
    }

    private static boolean bhkOk(Query q, Ranked r) {
        BigDecimal mine = r.property().getBhk();
        double a = mine == null ? 0 : mine.doubleValue();
        double b = q.bhk() == null ? 0 : q.bhk().doubleValue();
        return Math.abs(a - b) <= 1;
    }

    private static boolean priceOk(Query q, Ranked r) {
        long theirs = orZero(r.property().getPrice());
        long mine = orZero(q.price());
        return mine == 0 || theirs == 0 || (theirs >= mine * PRICE_LOW && theirs <= mine * PRICE_HIGH);
    }

    private static long orZero(Long v) {
        return v == null ? 0 : v;
    }

    private static double km(Query q, Property p) {
        if (q.lat() == null || q.lng() == null || p.getLat() == null || p.getLng() == null) {
            return Double.POSITIVE_INFINITY;
        }
        double dLat = Math.toRadians(p.getLat() - q.lat());
        double dLng = Math.toRadians(p.getLng() - q.lng());
        double s = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(Math.toRadians(q.lat()))
                * Math.cos(Math.toRadians(p.getLat())) * Math.pow(Math.sin(dLng / 2), 2);
        return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
    }
}
