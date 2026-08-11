package com.punenest.api.catalog.property;

import java.util.List;
import java.util.Set;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

/**
 * Central sort whitelist for the catalogue's paged endpoints. Sorting is an attack/serve surface —
 * an unrestricted {@code ?sort=} lets a client order by (and thereby probe) any column and can force
 * an unindexed scan — so both the public search and the owner listings clamp to these fields, each
 * of which a DB index can serve. Anything else is dropped and we fall back to newest-first.
 */
public final class PropertySort {

    private static final Set<String> ALLOWED = Set.of("createdAt", "price", "area", "bhk");
    private static final Sort DEFAULT = Sort.by(Sort.Direction.DESC, "createdAt");

    /**
     * Final tiebreaker appended to every order, so the sort is always <em>total</em>.
     *
     * <p>None of the whitelisted columns is unique. Two listings posted in the same instant, or
     * carrying the same price, tie — and a tie under {@code ORDER BY} is resolved by whatever the
     * planner finds convenient, which is free to differ between two executions of the identical
     * query. On a single unpaged read that is merely untidy. Across a paged read it is a
     * correctness bug: page 1 and page 2 are separate queries, so a row that sorts differently
     * between them is returned twice or skipped entirely, and the reader has no way to tell.
     *
     * <p>{@code id} is the primary key, so appending it can never change the relative order of two
     * rows that genuinely differ on the requested column — it only decides the ties. It is
     * deliberately not in {@link #ALLOWED}: a client may not sort by it (a UUID order discloses
     * nothing useful and is not a product feature), it may only rely on it to keep paging stable.
     */
    private static final Sort.Order TIEBREAK = Sort.Order.desc("id");

    private PropertySort() {
    }

    /** Return a pageable whose sort is limited to the whitelist (newest-first when none remain). */
    public static Pageable sanitize(Pageable pageable) {
        List<Sort.Order> safe = pageable.getSort().stream()
                .filter(o -> ALLOWED.contains(o.getProperty()))
                .toList();
        Sort sort = (safe.isEmpty() ? DEFAULT : Sort.by(safe)).and(Sort.by(TIEBREAK));
        return PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), sort);
    }

    /**
     * Did the caller actually ask for an order we honour? (D59)
     *
     * <p>Distinguishes "sorted newest-first because that is the default" from "sorted newest-first
     * because the client asked for it" — {@link #sanitize} collapses both to the same pageable, so
     * it cannot answer this. Boost ranking rides on the former only: promotion may reorder the
     * default view, but a client that chose {@code price,asc} gets price ascending and nothing
     * else. A junk or non-whitelisted {@code ?sort=} counts as no sort, matching what
     * {@link #sanitize} does with it.
     */
    public static boolean hasExplicitSort(Pageable pageable) {
        return pageable.getSort().stream().anyMatch(o -> ALLOWED.contains(o.getProperty()));
    }
}
