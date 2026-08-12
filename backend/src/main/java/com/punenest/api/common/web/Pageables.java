package com.punenest.api.common.web;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

/**
 * Pageable helpers shared by every paged controller.
 *
 * <p>See api-standards.md §5 — a list endpoint either publishes a whitelist of sortable fields, or
 * it fixes its order server-side. This class serves the second case.
 */
public final class Pageables {

    private Pageables() {
    }

    /**
     * Strip any client-supplied sort, keeping only page and size.
     *
     * <p>Spring binds {@code ?sort=} into a {@link Pageable} argument whether or not the endpoint
     * publishes a sort parameter. On an endpoint whose order is fixed server-side, that sort is
     * appended to the query and an unknown property name becomes a 500 — a server error any
     * anonymous caller can trigger with a guess. Rebuilding the {@code Pageable} from page and size
     * alone drops it before it can reach the query.
     *
     * <p>Endpoints that publish a sort must NOT use this; they validate against their own whitelist
     * so that an unknown value is a 400 naming the legal ones.
     *
     * @return the same page and size with no sort
     */
    public static Pageable unsorted(Pageable pageable) {
        return PageRequest.of(pageable.getPageNumber(), pageable.getPageSize());
    }
}
