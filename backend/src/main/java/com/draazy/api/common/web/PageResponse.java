package com.draazy.api.common.web;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;

/** {@link #of(Page, Function)} is the one place a Spring {@link Page} is translated, so every list endpoint stays
 * byte-compatible with the frontend; {@code counts} are omitted from the wire unless {@link #withCounts} set them. */
public record PageResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages,
        String sort,
        @JsonInclude(JsonInclude.Include.NON_NULL) Map<String, Long> counts) {

    public PageResponse(List<T> content, int page, int size, long totalElements, int totalPages,
            String sort) {
        this(content, page, size, totalElements, totalPages, sort, null);
    }

    public PageResponse<T> withCounts(Map<String, Long> totals) {
        return new PageResponse<>(content, page, size, totalElements, totalPages, sort, totals);
    }

    /** Map a persistence {@link Page} of entities to a wire page of DTOs. */
    public static <E, T> PageResponse<T> of(Page<E> page, Function<E, T> mapper) {
        List<T> content = page.getContent().stream().map(mapper).toList();
        return new PageResponse<>(
                content,
                page.getNumber(),
                page.getSize(),
                page.getTotalElements(),
                page.getTotalPages(),
                formatSort(page.getSort()));
    }

    private static String formatSort(Sort sort) {
        if (sort == null || sort.isUnsorted()) {
            return null;
        }
        return sort.stream()
                .map(o -> o.getProperty() + "," + o.getDirection().name().toLowerCase())
                .collect(Collectors.joining(";"));
    }
}
