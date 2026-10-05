package com.draazy.api.catalog.property;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Stream;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

/** Clamp sortable fields to indexed columns so clients cannot probe or force scans. */
public final class PropertySort {

    private static final Set<String> ALLOWED = Set.of("createdAt", "price", "area", "bhk");

    private static final Set<String> MODERATION_ALLOWED =
            Set.of("createdAt", "price", "area", "bhk", "recheckRequestedAt", "ownershipRequestedAt", "lastConfirmedAt");
    private static final Sort DEFAULT = Sort.by(Sort.Direction.DESC, "createdAt");

    /** Append an id tiebreaker so equal prices/timestamps do not page in planner order. */
    private static final Sort.Order TIEBREAK = Sort.Order.desc("id");

    private PropertySort() {
    }

    enum Rank {
        RELEVANCE,
        NEWEST,
        PRICE_PER_SQFT,
        VERIFIED
    }

    public static Pageable sanitize(Pageable pageable) {
        return sanitize(pageable, ALLOWED);
    }

    public static Pageable sanitizeModeration(Pageable pageable) {
        return sanitize(pageable, MODERATION_ALLOWED);
    }

    private static Pageable sanitize(Pageable pageable, Set<String> allowed) {
        List<Sort.Order> safe = pageable.getSort().stream()
                .filter(o -> allowed.contains(o.getProperty()))
                .flatMap(PropertySort::neverConfirmedIsStalest)
                .toList();
        Sort sort = (safe.isEmpty() ? DEFAULT : Sort.by(safe)).and(Sort.by(TIEBREAK));
        return PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), sort);
    }

    private static Stream<Sort.Order> neverConfirmedIsStalest(Sort.Order o) {
        if (!"lastConfirmedAt".equals(o.getProperty())) {
            return Stream.of(o);
        }
        return Stream.of(o.isAscending() ? o.nullsFirst() : o.nullsLast(), new Sort.Order(o.getDirection(), "createdAt"));
    }

    /** Distinguishes explicit sorting from the default after {@link #sanitize} collapses both. */
    public static boolean hasExplicitSort(Pageable pageable) {
        return pageable.getSort().stream().anyMatch(o -> ALLOWED.contains(o.getProperty()));
    }

    public static Rank rank(String value) {
        if (value == null || value.isBlank()) {
            return Rank.RELEVANCE;
        }
        return switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "newest" -> Rank.NEWEST;
            case "pricepersqft" -> Rank.PRICE_PER_SQFT;
            case "verified" -> Rank.VERIFIED;
            default -> Rank.RELEVANCE;
        };
    }
}
