package com.punenest.api.admin;

import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The three back-office read surfaces: the KPI scorecard, a time series, and the finance overview.
 *
 * <p>Everything here is derived. Nothing is stored, nothing is cached, and no figure is written
 * down anywhere — which is deliberate, because a cached KPI is a number that used to be true and a
 * stored one is a number that has to be kept true by every write path on the platform.
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

    private final AdminMetricsRepository metrics;

    public AdminMetricsService(AdminMetricsRepository metrics) {
        this.metrics = metrics;
    }

    /**
     * {@code GET /admin/dashboard} — the ops scorecard.
     *
     * <p>Six counts and one money figure, deliberately unbatched. They are six index-only counts on
     * a Postgres that is doing nothing else; folding them into one round trip would buy a few
     * milliseconds and cost the ability to read what any line means.
     */
    @Transactional(readOnly = true)
    public AdminKpis dashboard(AuthPrincipal caller) {
        boolean admin = Roles.Wire.ADMIN.equals(caller.role());
        return new AdminKpis(
                metrics.countListings(null),
                metrics.countListings("approved"),
                metrics.countListings("pending"),
                metrics.countUsers(null),
                metrics.countUsers(7),
                metrics.countDealsClosed(30),
                admin ? totalRevenue(LocalDate.now().minusDays(30), LocalDate.now().plusDays(1))
                        : null);
    }

    /**
     * {@code GET /admin/finance} — admin only.
     *
     * <p>All time, not a window: the question this screen answers is "where is the money", and a
     * liability does not stop being owed because it was collected last quarter.
     */
    @Transactional(readOnly = true)
    public AdminFinance finance() {
        Map<String, Long> bySource = metrics.revenueBySource(null, null);
        long revenue = bySource.values().stream().mapToLong(Long::longValue).sum();
        List<AdminFinance.Line> breakdown = bySource.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> new AdminFinance.Line(e.getKey(), e.getValue()))
                .toList();
        return new AdminFinance(revenue, metrics.payoutsDue(), 0L, 0L, breakdown);
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
        LocalDate end = (to == null ? LocalDate.now() : to);
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

        Map<LocalDate, Long> observed = new HashMap<>();
        for (Object[] row : rowsFor(metric, bucket, queryStart, exclusiveEnd)) {
            observed.put(toLocalDate(row[0]), ((Number) row[1]).longValue());
        }
        return buckets.stream()
                .map(day -> new AnalyticsPoint(day, observed.getOrDefault(day, 0L)))
                .toList();
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
}
