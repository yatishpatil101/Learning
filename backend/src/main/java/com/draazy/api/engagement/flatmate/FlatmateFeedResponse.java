package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.PageResponse;
import java.util.List;

/**
 * The flatmate feed response: the standard {@code PageEnvelope} fields plus {@code verifiedElements},
 * counted over the whole match by the statement that produced this page so the two cannot disagree.
 */
public record FlatmateFeedResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages,
        String sort,
        long verifiedElements) {

    /** Widen a mapped page with the aggregate. */
    public static <T> FlatmateFeedResponse<T> of(PageResponse<T> page, long verifiedElements) {
        return new FlatmateFeedResponse<>(
                page.content(),
                page.page(),
                page.size(),
                page.totalElements(),
                page.totalPages(),
                page.sort(),
                verifiedElements);
    }
}
