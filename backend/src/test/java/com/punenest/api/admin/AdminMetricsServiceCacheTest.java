package com.punenest.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.punenest.api.moderation.report.ReportService;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * D69 proof: identical analytics requests within the TTL should hit the in-process cache rather
 * than re-running the grouped SQL every time.
 */
class AdminMetricsServiceCacheTest {

    @Test
    void repeatedSeriesReadWithinTtlUsesCache() {
        AdminMetricsRepository repo = mock(AdminMetricsRepository.class);
        ReportService reports = mock(ReportService.class);
        // Explicit TTL: the suite's application.properties sets it to 0 (cache off) so the HTTP
        // tests see read-after-write, so this test has to supply production's value itself or it
        // would assert caching against a service configured not to cache.
        AdminMetricsService service = new AdminMetricsService(repo, reports, 30_000L);

        LocalDate today = LocalDate.now();
        LocalDate weekAgo = today.minusDays(6);
        List<Object[]> rows = Collections.singletonList(
            new Object[] {Timestamp.valueOf(today.atStartOfDay()), 3L});

        when(repo.countSeries(eq("users"), eq("joined_at"),
                eq("t.archived = false"), eq("day"), any(LocalDate.class), any(LocalDate.class)))
                .thenReturn(rows);

        List<AnalyticsPoint> first = service.series("users", weekAgo, today, "day");
        List<AnalyticsPoint> second = service.series("users", weekAgo, today, "day");

        assertThat(first).isEqualTo(second);
        verify(repo, times(1)).countSeries(eq("users"), eq("joined_at"),
                eq("t.archived = false"), eq("day"), any(LocalDate.class), any(LocalDate.class));
    }

    /**
     * The cache key includes the caller's date range, so a staff account that walks {@code from}
     * can mint a new entry per request. Expired entries are only dropped when that same key is
     * asked for again, which a sweeping caller never does — so without a cap the map grows for as
     * long as the process lives. Proven behaviourally: after enough distinct ranges, the earliest
     * one is gone and has to be re-queried.
     */
    @Test
    void theCacheDoesNotGrowWithoutBound() {
        AdminMetricsRepository repo = mock(AdminMetricsRepository.class);
        ReportService reports = mock(ReportService.class);
        AdminMetricsService service = new AdminMetricsService(repo, reports, 300_000L);

        LocalDate today = LocalDate.now();
        when(repo.countSeries(eq("users"), eq("joined_at"),
                eq("t.archived = false"), eq("day"), any(LocalDate.class), any(LocalDate.class)))
                .thenReturn(Collections.emptyList());

        LocalDate firstFrom = today.minusDays(6);
        service.series("users", firstFrom, today, "day");

        // Comfortably past any sane cap, and every range distinct so every one is a fresh key.
        for (int i = 1; i <= 200; i++) {
            service.series("users", today.minusDays(6 + i), today, "day");
        }

        // The TTL has not come close to elapsing, so a hit here would mean the entry survived —
        // i.e. nothing was evicted and the map is unbounded.
        service.series("users", firstFrom, today, "day");
        verify(repo, times(2)).countSeries(eq("users"), eq("joined_at"),
                eq("t.archived = false"), eq("day"), eq(firstFrom), any(LocalDate.class));
    }
}
