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

@Service
public class AdminFinanceService {

    // The console offers 6, 12 and 24; the extra headroom is for an operator typing a range by hand.
    private static final int MAX_FINANCE_MONTHS = 60;

    private static final int MAX_LEDGER_PAGE = 100;

    private static final long MAX_LEDGER_OFFSET = 100_000L;

    // These are contract enums, not query results; the spec must stay closed.
    private static final List<String> LEDGER_KINDS =
            List.of("subscription");

    private static final List<String> LEDGER_STATUSES = List.of("paid", "pending", "failed");

    // Includes the tiebreak so the page envelope matches the stable SQL order.
    private static final Sort LEDGER_SORT =
            Sort.by(Sort.Order.desc("date").nullsLast(), Sort.Order.asc("id"));

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

    // All-time by design: liabilities do not stop mattering after the quarter ends.
    // `refunds` is still the literal zero it has always been, because nothing on the platform can move it.
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

    @Transactional(readOnly = true)
    public List<AdminFinanceSeriesPoint> financeSeries(int months) {
        if (months < 1 || months > MAX_FINANCE_MONTHS) {
            throw new BadRequestException(
                    "months must be between 1 and " + MAX_FINANCE_MONTHS);
        }
        LocalDate thisMonth = LocalDate.now(PlatformTime.IST).withDayOfMonth(1);
        LocalDate from = thisMonth.minusMonths(months - 1L);
        LocalDate to = thisMonth.plusMonths(1);

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

                    // Structural, not missing: see AdminFinanceSeriesPoint's Javadoc and the
                    // `serviceOrdersCounted` disclosure that travels with it on /admin/finance.
                    0L));
        }
        return List.copyOf(points);
    }

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

        // Widened before multiplying, and capped after.
        // The long prevents overflow; the cap prevents pointless full ledger scans.
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
