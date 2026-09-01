package com.punenest.api.admin;

import com.punenest.api.common.PlatformTime;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.moderation.report.ReportService;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The two staff-visible back-office read surfaces: the KPI scorecard and the analytics time series.
 *
 * <p>Everything here is derived. Nothing is stored and no figure is written down anywhere — which
 * is deliberate, because a stored KPI is a number that has to be kept true by every write path on
 * the platform. The one exception is the D69 series cache below, which holds a *derived* answer for
 * a few seconds and can only ever be stale, never wrong.
 *
 * <p>The money screens used to live here too and are now {@link AdminFinanceService}. They read the
 * same repository, which is what kept them together for so long, but they answer to a different
 * guard and a different question — these are operational counts an ops lead watches, those are
 * amounts owed and settled that only an admin may see.
 *
 * <p><strong>Every window is cut on the Indian calendar</strong> (tech debt D179), matching
 * {@link AdminMetricsRepository}, which buckets in the same zone inside SQL. A bare
 * {@code LocalDate.now()} here would open the window on the host's date while the query grouped by
 * India's, so on a UTC host the first and last buckets of every chart would each hold part of a day
 * that the window's own edges disagree about.
 */
@Service
public class AdminMetricsService {

    /** How far back {@code /admin/analytics} looks when the caller does not say. */
    private static final int DEFAULT_WINDOW_DAYS = 30;

    /**
     * Ceiling on how many buckets one request may ask for.
     *
     * <p>Without it {@code from=1900-01-01&interval=day} is a grouped scan of every row the
     * platform owns, returned as forty thousand JSON objects, available to any staff account. A
     * year of days, or a century of months, is more than any chart renders.
     */
    private static final int MAX_BUCKETS = 366;

    private static final String LISTINGS = "listings";
    private static final String USERS = "users";
    private static final String DEALS = "deals";
    private static final String REVENUE = "revenue";

    private static final List<String> INTERVALS = List.of("day", "week", "month");

    /**
     * D69: short-lived cache for analytics series.
     *
     * <p>The endpoint is read-only and naturally bursty (same chart refreshed by many operators),
     * so a tiny in-process TTL cache cuts repeated grouped scans without introducing cross-node
     * coherence or external infrastructure.
     *
     * <p>Configurable, and set to {@code 0} by the test profile. Not for tidiness: the cache makes
     * the endpoint deliberately stale for a few seconds, and an integration test that writes a row
     * and then re-reads the chart is asserting read-after-write, which is a different property. With
     * the cache live those tests fail for a reason that is correct behaviour, and the temptation is
     * then to weaken the assertion — losing the bucketing guarantees they actually exist to protect.
     * The caching behaviour itself stays proven, by {@code AdminMetricsServiceCacheTest}.
     */
    private static final String CACHE_TTL_PROPERTY = "${punenest.metrics.series-cache-ttl-ms:30000}";

    /**
     * Ceiling on distinct cached series.
     *
     * <p>The key includes the caller's date range, so without a cap any staff account can grow this
     * map without bound just by walking {@code from}/{@code to} — entries expire but are only
     * *evicted* when that exact key is asked for again, which a sweeping caller never does.
     */
    private static final int MAX_CACHE_ENTRIES = 64;

    private final AdminMetricsRepository metrics;
    private final ReportService reports;
    private final long seriesCacheTtlMillis;
    private final Map<SeriesCacheKey, CachedSeries> seriesCache = new ConcurrentHashMap<>();

    public AdminMetricsService(AdminMetricsRepository metrics, ReportService reports,
            @Value(CACHE_TTL_PROPERTY) long seriesCacheTtlMillis) {
        this.metrics = metrics;
        this.reports = reports;
        this.seriesCacheTtlMillis = seriesCacheTtlMillis;
    }

    /**
     * {@code GET /admin/dashboard} — the ops scorecard.
     *
     * <p>Seven counts and one money figure, deliberately unbatched. They are seven index-only counts
     * on a Postgres that is doing nothing else; folding them into one round trip would buy a few
     * milliseconds and cost the ability to read what any line means.
     *
     * <p>{@code openReports} is asked of {@link ReportService} rather than counted here (tech debt
     * D68). Which statuses count as "still outstanding" is the abuse queue's rule, and a scorecard
     * that kept its own copy of it is how a tile and the screen it links to end up disagreeing.
     */
    @Transactional(readOnly = true)
    public AdminKpis dashboard(AuthPrincipal caller) {
        boolean admin = Roles.Wire.ADMIN.equals(caller.role());
        // Read once: two calls either side of midnight would open a 32-day window, and the pair
        // straddling it is exactly the case nobody would ever reproduce.
        LocalDate today = LocalDate.now(PlatformTime.IST);
        return new AdminKpis(
                metrics.countListings(null),
                metrics.countListings("approved"),
                metrics.countListings("pending"),
                reports.openCount(),
                metrics.countUsers(null),
                metrics.countUsers(7),
                metrics.countDealsClosed(30),
                admin ? totalRevenue(today.minusDays(DEFAULT_WINDOW_DAYS), today.plusDays(1))
                        : null);
    }

    /**
     * {@code GET /admin/analytics} — one metric, bucketed over a date range.
     *
     * <p>Empty buckets are filled with zero rather than omitted. A series with gaps renders as a
     * line that jumps from Monday to Thursday, which reads as "nothing was recorded" when it means
     * "nothing happened" — and the two are very different answers to give an operator.
     */
    @Transactional(readOnly = true)
    public List<AnalyticsPoint> series(String metric, LocalDate from, LocalDate to,
            String interval) {
        String bucket = (interval == null || interval.isBlank()) ? "day" : interval;
        if (!INTERVALS.contains(bucket)) {
            throw new BadRequestException("interval must be one of " + INTERVALS);
        }
        LocalDate end = (to == null ? LocalDate.now(PlatformTime.IST) : to);
        LocalDate start = (from == null ? end.minusDays(DEFAULT_WINDOW_DAYS) : from);
        if (start.isAfter(end)) {
            throw new BadRequestException("'from' must not be after 'to'");
        }
        // The window is half-open on the wire but the caller means "including `to`", so the query
        // gets the day after. Doing it here rather than in SQL keeps every predicate identical.
        LocalDate exclusiveEnd = end.plusDays(1);
        // The query window starts at the *aligned* boundary, not at `from`. On a weekly or monthly
        // series `align` moves the first bucket earlier — asking for a week from Wednesday puts the
        // first bucket on Monday — and querying from Wednesday would leave that bucket holding two
        // days less than it claims. A bucket that silently reports a fraction of itself is worse
        // than one that starts before the caller asked, because only the first is invisible.
        LocalDate queryStart = align(start, bucket);

        List<LocalDate> buckets = bucketsBetween(queryStart, exclusiveEnd, bucket);
        if (buckets.size() > MAX_BUCKETS) {
            throw new BadRequestException("Range too wide: at most " + MAX_BUCKETS
                    + " " + bucket + " buckets per request");
        }

        SeriesCacheKey cacheKey = new SeriesCacheKey(metric, queryStart, exclusiveEnd, bucket);
        List<AnalyticsPoint> cached = getCachedSeries(cacheKey);
        if (cached != null) {
            return cached;
        }

        Map<LocalDate, Long> observed = new HashMap<>();
        for (Object[] row : rowsFor(metric, bucket, queryStart, exclusiveEnd)) {
            observed.put(BucketDate.of(row[0]), ((Number) row[1]).longValue());
        }
        List<AnalyticsPoint> computed = buckets.stream()
                .map(day -> new AnalyticsPoint(day, observed.getOrDefault(day, 0L)))
                .toList();
        List<AnalyticsPoint> snapshot = Collections.unmodifiableList(new ArrayList<>(computed));
        putCachedSeries(cacheKey, snapshot);
        return snapshot;
    }

    private void putCachedSeries(SeriesCacheKey key, List<AnalyticsPoint> points) {
        if (seriesCacheTtlMillis <= 0) {
            return;
        }
        long now = System.currentTimeMillis();
        if (seriesCache.size() >= MAX_CACHE_ENTRIES) {
            seriesCache.values().removeIf(entry -> entry.expiresAtMillis() <= now);
            // Still full means the pressure is live entries, not litter. Drop the lot rather than
            // pick a victim: at this TTL the whole map is worth less than the code to rank it, and
            // an unbounded map is the only outcome that is actually unsafe.
            if (seriesCache.size() >= MAX_CACHE_ENTRIES) {
                seriesCache.clear();
            }
        }
        seriesCache.put(key, new CachedSeries(points, now + seriesCacheTtlMillis));
    }

    private List<AnalyticsPoint> getCachedSeries(SeriesCacheKey key) {
        if (seriesCacheTtlMillis <= 0) {
            return null;
        }
        CachedSeries cached = seriesCache.get(key);
        if (cached == null) {
            return null;
        }
        if (cached.expiresAtMillis() <= System.currentTimeMillis()) {
            seriesCache.remove(key, cached);
            return null;
        }
        return cached.points();
    }

    /** Dispatch a metric name onto the table, column and filter that answer it. */
    private List<Object[]> rowsFor(String metric, String interval, LocalDate from, LocalDate to) {
        return switch (metric) {
            case LISTINGS -> metrics.countSeries("properties", "created_at",
                    "t.archived = false", interval, from, to);
            case USERS -> metrics.countSeries("users", "joined_at",
                    "t.archived = false", interval, from, to);
            case DEALS -> metrics.countSeries("deals", "closed_at",
                    "t.status = 'closed' and t.closed_at is not null", interval, from, to);
            case REVENUE -> metrics.revenueSeries(interval, from, to);
            case null, default -> throw new BadRequestException(
                    "Unknown metric '" + metric + "'; expected one of ["
                            + String.join(", ", LISTINGS, USERS, DEALS, REVENUE) + "]");
        };
    }

    private long totalRevenue(LocalDate from, LocalDate to) {
        return metrics.revenueBySource(from, to).values().stream()
                .mapToLong(Long::longValue).sum();
    }

    /**
     * Every bucket start between {@code start} (inclusive) and {@code end} (exclusive).
     *
     * <p>{@code start} is expected to be already aligned; {@link #align} is applied again as a
     * safety net so the first bucket can never differ from the rest.
     *
     * <p>Aligned the same way {@code date_trunc} aligns: weeks begin on Monday and months on the
     * 1st. If this drifted from the SQL, every filled bucket would miss its observed value and the
     * chart would silently read zero everywhere.
     */
    private static List<LocalDate> bucketsBetween(LocalDate start, LocalDate end, String interval) {
        List<LocalDate> buckets = new ArrayList<>();
        LocalDate cursor = align(start, interval);
        while (cursor.isBefore(end) && buckets.size() <= MAX_BUCKETS) {
            buckets.add(cursor);
            cursor = switch (interval) {
                case "week" -> cursor.plusWeeks(1);
                case "month" -> cursor.plusMonths(1);
                default -> cursor.plusDays(1);
            };
        }
        return buckets;
    }

    private static LocalDate align(LocalDate date, String interval) {
        return switch (interval) {
            case "week" -> date.with(TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY));
            case "month" -> date.withDayOfMonth(1);
            default -> date;
        };
    }

    private record SeriesCacheKey(String metric, LocalDate from, LocalDate to, String interval) {}

    private record CachedSeries(List<AnalyticsPoint> points, long expiresAtMillis) {}
}
