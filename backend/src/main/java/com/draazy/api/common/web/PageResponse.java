package com.draazy.api.common.web;

import java.util.List;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Sort;

/**
 * The contract pagination envelope ({@code PageEnvelope} + a typed {@code content}):
 * {@code { content, page, size, totalElements, totalPages, sort }}. Zero-indexed {@code page}.
 *
 * <p>{@link #of(Page, Function)} is the one place a Spring {@link Page} is translated for the wire,
 * so every list endpoint stays byte-compatible with the frontend without repeating mapping code.
 *
 * @param sort echoed back as {@code field,dir} (e.g. {@code createdAt,desc}); {@code null} if unsorted
 */
public record PageResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages,
        String sort) {

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
