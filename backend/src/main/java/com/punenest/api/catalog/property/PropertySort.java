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

    private PropertySort() {
    }

    /** Return a pageable whose sort is limited to the whitelist (newest-first when none remain). */
    public static Pageable sanitize(Pageable pageable) {
        List<Sort.Order> safe = pageable.getSort().stream()
                .filter(o -> ALLOWED.contains(o.getProperty()))
                .toList();
        Sort sort = safe.isEmpty() ? DEFAULT : Sort.by(safe);
        return PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), sort);
    }
}
