package com.punenest.api.admin;

import com.punenest.api.common.PlatformTime;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.web.PageResponse;
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
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The three back-office read surfaces: the KPI scorecard, a time series, and the finance overview.
 *
 * <p>Everything here is derived. Nothing is stored and no figure is written down anywhere — which
 * is deliberate, because a stored KPI is a number that has to be kept true by every write path on
 * the platform. The one exception is the D69 series cache below, which holds a *derived* answer for
 * a few seconds and can only ever be stale, never wrong.
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
     * Ceiling on how many monthly buckets the finance chart may ask for.
     *
     * <p>Five years. The console offers 6, 12 and 24; the extra headroom is for an operator typing
     * a range by hand, and the cap is here so that "by hand" cannot mean a grouped scan of every
     * settled payment since the platform opened.
     */
    private static final int MAX_FINANCE_MONTHS = 60;

    /** Ceiling on one page of the settlement ledger. The console asks for 15. */
    private static final int MAX_LEDGER_PAGE = 100;

    /**
     * Ceiling on how many ledger rows a caller may skip.
     *
     * <p>The page number arrives on the query string, so {@code ?page=} is an unbounded integer a
     * caller chooses. {@code financeTransactions} widens the multiplication to a {@code long} to
     * stop it wrapping negative — Postgres rejects a negative offset, which would surface as an
     * unhandled 500 — but the arithmetic being correct is not the same as the query being sensible.
     * Every page past the end of the ledger is a full scan of every money row on the platform,
     * sorted, and then discarded in its entirety.
     *
     * <p>A hundred thousand is far past anywhere a human has paged to and far short of a scan worth
     * worrying about, which is the whole of the reasoning.
     */
    private static final long MAX_LEDGER_OFFSET = 100_000L;

    /**
     * The ledger's closed vocabularies.
     *
     * <p>Declared here rather than derived from the SQL because they are the contract: the same two
     * lists appear in the OpenAPI document as enums, and a filter the server accepts but never
     * matches is indistinguishable, from the console, from a quarter in which nothing was sold.
     */
    private static final List<String> LEDGER_KINDS =
            List.of("rent_fee", "subscription", "featured");

    private static final List<String> LEDGER_STATUSES = List.of("paid", "pending", "failed");

    /**
     * Echoed in the page envelope. Describes the order the SQL actually imposes, tiebreak included
     * — a {@code sort} field that under-describes the ordering is how a caller concludes a stable
     * page is unstable.
     */
    private static final Sort LEDGER_SORT =
            Sort.by(Sort.Order.desc("date").nullsLast(), Sort.Order.asc("id"));

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

    /**
     * Whether the figures beside these flags are measured or structurally zero (tech debt D63, D65).
     *
     * <p>Configuration and not data, deliberately. Nothing in the schema distinguishes "no rent was
     * refunded this month" from "this platform cannot refund", so no query can answer it; the
     * answer is a fact about which slices have shipped, which is exactly what a property is for.
     * Defaults are today's truth — no payout path, no refund path, service orders uncounted — and
     * flipping one is an environment change rather than a release, which is the whole point.
     *
     * <p>They disclose; they do not enable. Setting one true does not create the money path behind
     * it, it only stops {@code /admin/finance} from warning that the path is missing.
     */
    private static final String PAYOUTS_MEASURED_PROPERTY = "${punenest.finance.payouts-measured:false}";

    private static final String REFUNDS_MEASURED_PROPERTY = "${punenest.finance.refunds-measured:false}";

    private static final String SERVICE_ORDERS_COUNTED_PROPERTY = "${punenest.finance.service-orders-counted:false}";

    private final AdminMetricsRepository metrics;
    private final ReportService reports;
    private final long seriesCacheTtlMillis;
    private final boolean payoutsMeasured;
    private final boolean refundsMeasured;
    private final boolean serviceOrdersCounted;
    private final Map<SeriesCacheKey, CachedSeries> seriesCache = new ConcurrentHashMap<>();

    public AdminMetricsService(AdminMetricsRepository metrics, ReportService reports,
            @Value(CACHE_TTL_PROPERTY) long seriesCacheTtlMillis,
            @Value(PAYOUTS_MEASURED_PROPERTY) boolean payoutsMeasured,
            @Value(REFUNDS_MEASURED_PROPERTY) boolean refundsMeasured,
            @Value(SERVICE_ORDERS_COUNTED_PROPERTY) boolean serviceOrdersCounted) {
        this.metrics = metrics;
        this.reports = reports;
        this.seriesCacheTtlMillis = seriesCacheTtlMillis;
        this.payoutsMeasured = payoutsMeasured;
        this.refundsMeasured = refundsMeasured;
        this.serviceOrdersCounted = serviceOrdersCounted;
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
     * {@code GET /admin/finance} — admin only.
     *
     * <p>All time, not a window: the question this screen answers is "where is the money", and a
     * liability does not stop being owed because it was collected last quarter.
     *
     * <p>{@code payoutsCompleted} and {@code refunds} are still the literal zeros they have always
     * been, because nothing on the platform can move either number. What is new is that the
     * response now says <em>why</em> (tech debt D63, D65): the three disclosure flags travel beside
     * the figures so the screen can mark a structural zero as one, instead of presenting it as a
     * month with no refunds in it.
     */
    @Transactional(readOnly = true)
    public AdminFinance finance() {
        Map<String, Long> bySource = metrics.revenueBySource(null, null);
        long revenue = bySource.values().stream().mapToLong(Long::longValue).sum();
        List<AdminFinance.Line> breakdown = bySource.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> new AdminFinance.Line(e.getKey(), e.getValue()))
                .toList();
        // One read, so the month tiles cannot straddle a boundary the way two would.
        LocalDate monthStart = LocalDate.now(PlatformTime.IST).withDayOfMonth(1);
        LocalDate nextMonth = monthStart.plusMonths(1);
        long monthRevenue = metrics.revenueBySource(monthStart, nextMonth).values().stream()
                .mapToLong(Long::longValue).sum();
        List<AdminFinance.PlanLine> plans = metrics.subscriptionPlanLines().stream()
                .map(row -> new AdminFinance.PlanLine(
                        (String) row[0],
                        (String) row[1],
                        (String) row[2],
                        ((Number) row[3]).longValue(),
                        ((Number) row[4]).longValue(),
                        ((Number) row[5]).longValue()))
                .toList();
        return new AdminFinance(revenue, metrics.payoutsDue(), 0L, 0L, breakdown,
                payoutsMeasured, refundsMeasured, serviceOrdersCounted,
                metrics.mrr(),
                monthRevenue,
                metrics.countUsers(null),
                metrics.payingUsers(monthStart, nextMonth),
                metrics.gstCollected(monthStart, nextMonth),
                metrics.pendingSettlement(),
                plans);
    }

    /**
     * {@code GET /admin/finance/series} — revenue per month, split by source, newest month last.
     *
     * <p><strong>Every month in the window is returned, including the empty ones.</strong> The same
     * rule {@link #series} follows and for a stronger reason here: this feeds a stacked bar chart,
     * and a gap in a bar chart is not a visible gap — the neighbouring bars simply move up and the
     * reader sees an unbroken run of trading months that did not happen.
     *
     * <p>The window ends with the <em>current</em> month, partial and included. A finance console
     * whose most recent complete bar is last month cannot answer "how are we doing", which is the
     * question it is opened to answer; the tile beside the chart says the month is in progress.
     *
     * @param months how many monthly buckets to return, counting back from and including this month
     */
    @Transactional(readOnly = true)
    public List<AdminFinanceSeriesPoint> financeSeries(int months) {
        if (months < 1 || months > MAX_FINANCE_MONTHS) {
            throw new BadRequestException(
                    "months must be between 1 and " + MAX_FINANCE_MONTHS);
        }
        LocalDate thisMonth = LocalDate.now(PlatformTime.IST).withDayOfMonth(1);
        LocalDate from = thisMonth.minusMonths(months - 1L);
        LocalDate to = thisMonth.plusMonths(1);

        // Source name to amount, per bucket. Absent pairs are zero, which is what the fill below
        // relies on — the query returns no row at all for a month in which nothing was sold.
        Map<LocalDate, Map<String, Long>> observed = new HashMap<>();
        for (Object[] row : metrics.revenueSeriesBySource("month", from, to)) {
            observed.computeIfAbsent(toLocalDate(row[0]), key -> new HashMap<>())
                    .merge((String) row[1], ((Number) row[2]).longValue(), Long::sum);
        }

        List<AdminFinanceSeriesPoint> points = new ArrayList<>();
        for (LocalDate cursor = from; !cursor.isAfter(thisMonth); cursor = cursor.plusMonths(1)) {
            Map<String, Long> found = observed.getOrDefault(cursor, Map.of());
            points.add(new AdminFinanceSeriesPoint(
                    cursor,
                    found.getOrDefault("rent", 0L),
                    found.getOrDefault("subscriptions", 0L),
                    found.getOrDefault("boosts", 0L),
                    // Structural, not missing: see AdminFinanceSeriesPoint's Javadoc and the
                    // `serviceOrdersCounted` disclosure that travels with it on /admin/finance.
                    0L));
        }
        return List.copyOf(points);
    }

    /**
     * {@code GET /admin/finance/transactions} — the settlement ledger, paged, newest first.
     *
     * <p>The filters are validated against a closed set rather than passed through. They reach a
     * native query, and while every one of them is a bound parameter, a vocabulary the server
     * accepts silently is a vocabulary the console can drift away from — asking for
     * {@code status=closed}, which is what the mock ledger used to call a settled row, should say
     * so rather than return an empty page that looks like a quiet quarter.
     */
    @Transactional(readOnly = true)
    public PageResponse<AdminFinanceTransaction> financeTransactions(
            String kind, String status, String q, int page, int size) {
        if (kind != null && !LEDGER_KINDS.contains(kind)) {
            throw new BadRequestException("kind must be one of " + LEDGER_KINDS);
        }
        if (status != null && !LEDGER_STATUSES.contains(status)) {
            throw new BadRequestException("status must be one of " + LEDGER_STATUSES);
        }
        int safeSize = Math.clamp(size, 1, MAX_LEDGER_PAGE);
        int safePage = Math.max(page, 0);
        /* Widened before multiplying, and capped after.
         *
         * `safePage * safeSize` as an `int` overflows at page 21,474,837 and wraps *negative*,
         * which Postgres rejects outright — an unhandled 500 reachable from a query string. The
         * long fixes the arithmetic; the ceiling is the actual answer, because every page beyond
         * the ledger's length is a full scan of every money row on the platform discarded in its
         * entirety, and no operator has ever paged to ten million.
         */
        long offset = (long) safePage * safeSize;
        if (offset > MAX_LEDGER_OFFSET) {
            throw new BadRequestException(
                    "page is beyond the ledger; at most " + MAX_LEDGER_OFFSET + " rows may be skipped");
        }
        // Escaped before wrapping: an operator searching for a party with an underscore or a
        // percent in the name would otherwise be running a wildcard they did not type.
        String term = (q == null || q.isBlank()) ? null
                : "%" + q.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";

        long total = metrics.ledgerCount(kind, status, term);
        List<AdminFinanceTransaction> rows = metrics
                .ledger(kind, status, term, safeSize, offset).stream()
                .map(row -> new AdminFinanceTransaction(
                        (UUID) row[0],
                        row[1] == null ? null : toLocalDate(row[1]),
                        (String) row[2],
                        (String) row[3],
                        ((Number) row[4]).longValue(),
                        (String) row[5],
                        (String) row[6]))
                .toList();
        return PageResponse.of(
                new PageImpl<>(rows, PageRequest.of(safePage, safeSize, LEDGER_SORT), total),
                java.util.function.Function.identity());
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
            observed.put(toLocalDate(row[0]), ((Number) row[1]).longValue());
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

    /**
     * Postgres hands {@code date_trunc} back as a {@code timestamp}; the JDBC driver may surface it
     * as {@link java.sql.Timestamp} or as a {@link java.time.LocalDateTime} depending on the type
     * mapping, so both are accepted rather than assumed.
     */
    private static LocalDate toLocalDate(Object bucket) {
        return switch (bucket) {
            case java.sql.Timestamp ts -> ts.toLocalDateTime().toLocalDate();
            case java.sql.Date date -> date.toLocalDate();
            case java.time.LocalDateTime dt -> dt.toLocalDate();
            case LocalDate date -> date;
            case java.time.OffsetDateTime odt -> odt.toLocalDate();
            case null, default -> throw new IllegalStateException(
                    "Unexpected bucket type from date_trunc: " + bucket);
        };
    }

    private record SeriesCacheKey(String metric, LocalDate from, LocalDate to, String interval) {}

    private record CachedSeries(List<AnalyticsPoint> points, long expiresAtMillis) {}
}
