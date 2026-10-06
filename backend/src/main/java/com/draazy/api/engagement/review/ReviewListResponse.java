package com.draazy.api.engagement.review;

import com.draazy.api.common.web.PageResponse;
import java.util.List;
import org.springframework.data.domain.Page;

/** {@code summary} covers every published review of the target, never just {@code content}. */
public record ReviewListResponse(
        List<ReviewResponse> content,
        int page,
        int size,
        long totalElements,
        int totalPages,
        String sort,
        ReviewSummaryResponse summary) {

    public static ReviewListResponse of(Page<ReviewResponse> page, ReviewSummaryResponse summary) {
        PageResponse<ReviewResponse> wire = PageResponse.of(page, dto -> dto);
        return new ReviewListResponse(wire.content(), wire.page(), wire.size(),
                wire.totalElements(), wire.totalPages(), wire.sort(), summary);
    }
}
