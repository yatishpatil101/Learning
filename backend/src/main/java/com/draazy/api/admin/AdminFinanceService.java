package com.draazy.api.admin;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.web.PageResponse;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The three money read surfaces behind {@code /admin/finance}: the overview, the monthly series and
 * the settlement ledger.
 *
 * <p>Split out of {@link AdminMetricsService}, which had grown to hold two jobs that only looked
 * alike. Both read the same repository and both bucket by month, but they answer to different
 * questions and different guards — the scorecard and the analytics chart are staff-visible
 * operational counts, while everything here is admin-only and is about money owed, collected and
     * settled. The clearest sign they were separate all along is the constructor: the finance
     * disclosures it carries are ones the analytics half never read.
 *
 * <p><strong>Every window is cut on the Indian calendar</strong> (tech debt D179), matching
 * {@link AdminMetricsRepository}, which buckets in the same zone inside SQL. A bare
 * {@code LocalDate.now()} here would open the window on the host's date while the query grouped by
 * India's, so on a UTC host the first and last buckets of every chart would each hold part of a day
 * that the window's own edges disagree about.
 */
@Service
public class AdminFinanceService {

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
            List.of("subscription", "featured");

    private static final List<String> LEDGER_STATUSES = List.of("paid", "pending", "failed");

    /**
     * Echoed in the page envelope. Describes the order the SQL actually imposes, tiebreak included
     * — a {@code sort} field that under-describes the ordering is how a caller concludes a stable
     * page is unstable.
     */
    private static final Sort LEDGER_SORT =
            Sort.by(Sort.Order.desc("date").nullsLast(), Sort.Order.asc("id"));

    /**
     * Whether the figures beside these flags are measured or structurally zero (tech debt D63, D65).
     *
     * <p>Configuration and not data, deliberately. Nothing in the schema distinguishes "nothing was
     * refunded this month" from "this platform cannot refund", so no query can answer it; the
     * answer is a fact about which slices have shipped, which is exactly what a property is for.
     * Defaults are today's truth — no refund path, service orders uncounted — and
     * flipping one is an environment change rather than a release, which is the whole point.
     *
     * <p>They disclose; they do not enable. Setting one true does not create the money path behind
     * it, it only stops {@code /admin/finance} from warning that the path is missing.
     */
    private static final String REFUNDS_MEASURED_PROPERTY = "${draazy.finance.refunds-measured:false}";

    private static final String SERVICE_ORDERS_COUNTED_PROPERTY = "${draazy.finance.service-orders-counted:false}";

    private final AdminMetricsRepository metrics;
    private final boolean refundsMeasured;
    private final boolean serviceOrdersCounted;

    public AdminFinanceService(AdminMetricsRepository metrics,
            @Value(REFUNDS_MEASURED_PROPERTY) boolean refundsMeasured,
            @Value(SERVICE_ORDERS_COUNTED_PROPERTY) boolean serviceOrdersCounted) {
        this.metrics = metrics;
        this.refundsMeasured = refundsMeasured;
        this.serviceOrdersCounted = serviceOrdersCounted;
    }

    /**
     * {@code GET /admin/finance} — admin only.
     *
     * <p>All time, not a window: the question this screen answers is "where is the money", and a
     * liability does not stop being owed because it was collected last quarter.
     *
     * <p>{@code refunds} is still the literal zero it has always been, because nothing on the
     * platform can move it. What is new is that the response now says <em>why</em> (tech debt D63,
     * D65): the disclosure flags travel beside the figures so the screen can mark a structural zero
     * as one, instead of presenting it as a month with no refunds in it.
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
        return new AdminFinance(revenue, 0L, breakdown,
                refundsMeasured, serviceOrdersCounted,
                metrics.mrr(),
                monthRevenue,
                metrics.countUsers(null),
                metrics.payingUsers(monthStart, nextMonth),
                plans);
    }

    /**
     * {@code GET /admin/finance/series} — revenue per month, split by source, newest month last.
     *
     * <p><strong>Every month in the window is returned, including the empty ones.</strong> The same
     * rule {@link AdminMetricsService#series} follows and for a stronger reason here: this feeds a
     * stacked bar chart, and a gap in a bar chart is not a visible gap — the neighbouring bars
     * simply move up and the reader sees an unbroken run of trading months that did not happen.
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
            observed.computeIfAbsent(BucketDate.of(row[0]), key -> new HashMap<>())
                    .merge((String) row[1], ((Number) row[2]).longValue(), Long::sum);
        }

        List<AdminFinanceSeriesPoint> points = new ArrayList<>();
        for (LocalDate cursor = from; !cursor.isAfter(thisMonth); cursor = cursor.plusMonths(1)) {
            Map<String, Long> found = observed.getOrDefault(cursor, Map.of());
            points.add(new AdminFinanceSeriesPoint(
                    cursor,
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
                        row[1] == null ? null : BucketDate.of(row[1]),
                        (String) row[2],
                        (String) row[3],
                        ((Number) row[4]).longValue(),
                        (String) row[5]))
                .toList();
        return PageResponse.of(
                new PageImpl<>(rows, PageRequest.of(safePage, safeSize, LEDGER_SORT), total),
                java.util.function.Function.identity());
    }
}
