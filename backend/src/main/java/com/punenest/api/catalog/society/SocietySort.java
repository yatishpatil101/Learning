package com.punenest.api.catalog.society;

import java.util.List;
import java.util.Set;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

/**
 * Sort whitelist for {@code GET /societies}, mirroring {@code catalog.property.PropertySort}.
 *
 * <p>An unrestricted {@code ?sort=} on a public endpoint lets an anonymous caller order by any
 * column — which both probes the schema and can force an unindexed full scan on demand. Anything
 * outside this set is dropped and the list falls back to alphabetical, which is what a directory
 * wants anyway.
 */
public final class SocietySort {

    private static final Set<String> ALLOWED = Set.of("name", "occupancy", "year", "units");
    private static final Sort DEFAULT = Sort.by(Sort.Direction.ASC, "name");

    private SocietySort() {
    }

    /** Return a pageable whose sort is limited to the whitelist (alphabetical when none remain). */
    public static Pageable sanitize(Pageable pageable) {
        List<Sort.Order> safe = pageable.getSort().stream()
                .filter(o -> ALLOWED.contains(o.getProperty()))
                .toList();
        return PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(),
                safe.isEmpty() ? DEFAULT : Sort.by(safe));
    }
}
