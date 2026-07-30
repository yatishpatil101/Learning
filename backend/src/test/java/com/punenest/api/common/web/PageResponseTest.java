package com.punenest.api.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

class PageResponseTest {

    @Test
    void mapsContentAndMetadataAndSort() {
        var pageable = PageRequest.of(1, 2, Sort.by(Sort.Direction.DESC, "createdAt"));
        var page = new PageImpl<>(List.of(10, 20), pageable, 7);

        PageResponse<String> result = PageResponse.of(page, i -> "n" + i);

        assertThat(result.content()).containsExactly("n10", "n20");
        assertThat(result.page()).isEqualTo(1);
        assertThat(result.size()).isEqualTo(2);
        assertThat(result.totalElements()).isEqualTo(7);
        assertThat(result.totalPages()).isEqualTo(4);
        assertThat(result.sort()).isEqualTo("createdAt,desc");
    }

    @Test
    void unsortedYieldsNullSort() {
        var page = new PageImpl<>(List.of(1), PageRequest.of(0, 20), 1);
        assertThat(PageResponse.of(page, i -> i).sort()).isNull();
    }

    @Test
    void multiFieldSortJoinedWithSemicolon() {
        var sort = Sort.by(Sort.Order.desc("createdAt"), Sort.Order.asc("id"));
        var page = new PageImpl<>(List.of(1), PageRequest.of(0, 20, sort), 1);
        assertThat(PageResponse.of(page, i -> i).sort()).isEqualTo("createdAt,desc;id,asc");
    }

    @Test
    void emptyPageYieldsZeroTotals() {
        var page = new PageImpl<Integer>(List.of(), PageRequest.of(0, 10), 0);
        var result = PageResponse.of(page, i -> i);
        assertThat(result.content()).isEmpty();
        assertThat(result.totalElements()).isZero();
        assertThat(result.totalPages()).isZero();
    }
}
