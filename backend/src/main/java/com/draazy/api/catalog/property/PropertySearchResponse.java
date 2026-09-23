package com.draazy.api.catalog.property;

import com.draazy.api.common.web.PageResponse;
import java.util.List;

// Restates the PageResponse fields rather than extending it, so a verified count is not added to
// every list endpoint; the aggregates cover the whole match, which a paged browser cannot compute.
public record PropertySearchResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages,
        String sort,
        long verifiedElements,
        long unstatedElements) {

    /** Widen a mapped page with the aggregates. */
    public static <T> PropertySearchResponse<T> of(PageResponse<T> page, long verifiedElements,
            long unstatedElements) {
        return new PropertySearchResponse<>(
                page.content(),
                page.page(),
                page.size(),
                page.totalElements(),
                page.totalPages(),
                page.sort(),
                verifiedElements,
                unstatedElements);
    }
}
