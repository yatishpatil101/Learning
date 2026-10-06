package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.PageResponse;
import java.util.List;

/** {@code verifiedElements} is counted by the statement that produced the page so the two cannot disagree. */
public record FlatmateFeedResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages,
        String sort,
        long verifiedElements,
        long otherTabElements) {

    public static <T> FlatmateFeedResponse<T> of(PageResponse<T> page, long verifiedElements,
            long otherTabElements) {
        return new FlatmateFeedResponse<>(
                page.content(),
                page.page(),
                page.size(),
                page.totalElements(),
                page.totalPages(),
                page.sort(),
                verifiedElements,
                otherTabElements);
    }
}
