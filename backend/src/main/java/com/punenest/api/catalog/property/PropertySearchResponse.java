package com.punenest.api.catalog.property;

import com.punenest.api.common.web.PageResponse;
import java.util.List;

/**
 * The search response: the standard {@code PageEnvelope} fields, plus one aggregate about the whole
 * match rather than the page — {@code verifiedElements}.
 *
 * <p><strong>Why this is not a field on {@link PageResponse}.</strong> The envelope is shared by
 * every list endpoint in the contract. A verified count is meaningless on outbound messages or
 * finance settlements, and adding it there would put a permanently-null field on a dozen responses
 * to serve one. The six envelope fields are restated here instead, which is the cost of keeping the
 * shared shape honest; {@link #of} is the only place they are copied, so they cannot drift.
 *
 * <p>The aggregate exists because the listings header states "N properties · M verified" and, once
 * the server pages, the browser can no longer see enough rows to compute M. Deriving it from the
 * page would leave two numbers side by side that quietly describe different sets.
 *
 * <p>The type parameter carries its weight despite the single instantiation: it is what lets the
 * contract parity check peel this envelope to the payload record the same way it peels
 * {@code PageResponse}, so {@code content}'s fields are still matched against the declared schema.
 *
 * @param verifiedElements listings in the whole match carrying a verified-owner or live
 *     ownership-verification badge — the same disjunction the browser used, so the number did not
 *     change meaning when it moved
 */
public record PropertySearchResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages,
        String sort,
        long verifiedElements) {

    /** Widen a mapped page with the aggregate. */
    public static <T> PropertySearchResponse<T> of(PageResponse<T> page, long verifiedElements) {
        return new PropertySearchResponse<>(
                page.content(),
                page.page(),
                page.size(),
                page.totalElements(),
                page.totalPages(),
                page.sort(),
                verifiedElements);
    }
}
