package com.draazy.api.finance.ledger;

import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.finance.tenancy.Tenancy;
import com.draazy.api.finance.tenancy.TenancyRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Owner-only, 404 never 403, so a property id's existence isn't leaked.
 * Dates use {@link PlatformTime#IST}: a UTC host lags 5.5 hours and would misfile month ends and 1 April. */
@Service
public class FinanceService {

    private static final DateTimeFormatter MONTH_KEY = DateTimeFormatter.ofPattern("yyyy-MM");

    /** Cap matching the contract's {@code months} parameter — a five-year chart is already absurd. */
    private static final int MAX_CASHFLOW_MONTHS = 60;

    private final TransactionRepository transactions;
    private final OwnershipBasisRepository bases;
    private final TenancyRepository tenancies;
    private final PropertyRepository properties;
    private final FinanceMapper mapper;

    /** Zone-agnostic instant source: tests pin it to UTC so the IST answer is the service's doing.
     * Not injected, as no {@code Clock} bean exists. */
    private Clock clock = Clock.systemUTC();

    public FinanceService(TransactionRepository transactions,
                          OwnershipBasisRepository bases,
                          TenancyRepository tenancies,
                          PropertyRepository properties,
                          FinanceMapper mapper) {
        this.transactions = transactions;
        this.bases = bases;
        this.tenancies = tenancies;
        this.properties = properties;
        this.mapper = mapper;
    }

    /** Tests only; the bean is proxied, so unwrap it with {@code AopTestUtils} and restore the clock after. */
    void useClock(Clock pinned) {
        this.clock = pinned == null ? Clock.systemUTC() : pinned;
    }

    /** Today's date <em>in India</em>, whatever timezone this process was started in. */
    private LocalDate todayIst() {
        return LocalDate.now(clock.withZone(PlatformTime.IST));
    }

    /** The calendar month currently running <em>in India</em>. */
    private YearMonth currentMonthIst() {
        return YearMonth.now(clock.withZone(PlatformTime.IST));
    }

    // ---- transactions ----

    /** Contract {@code listTransactions} — the caller's ledger for one property, newest first. */
    @Transactional(readOnly = true)
    public Page<TransactionDto> listTransactions(UUID callerId, UUID propertyId, Pageable pageable) {
        ownedPropertyId(callerId, propertyId);
        return transactions.findLiveByPropertyId(propertyId, pageable).map(mapper::toDto);
    }

    /** Contract {@code addTransaction} — records one row. Returns 201. */
    @Transactional
    public TransactionDto addTransaction(UUID callerId, UUID propertyId,
                                         TransactionCreateRequest body) {
        ownedPropertyId(callerId, propertyId);

        String type = requireValidType(body.type());
        String recurring = normaliseRecurring(body.recurring());

        Transaction row = new Transaction(propertyId, callerId, type, body.amount(), body.date());
        row.setCategory(blankToNull(body.category()));
        row.setNote(blankToNull(body.note()));
        row.setRecurring(recurring);
        return mapper.toDto(transactions.save(row));
    }

    /** Partial update: absent fields are left alone, and an empty string clears the two free-text fields. */
    @Transactional
    public TransactionDto updateTransaction(UUID callerId, UUID propertyId, UUID txnId,
                                            TransactionUpdateRequest body) {
        ownedPropertyId(callerId, propertyId);
        Transaction row = transactions.findLiveByIdAndPropertyId(txnId, propertyId)
                .orElseThrow(() -> NotFoundException.of("Transaction"));

        if (body.type() != null) {
            row.setType(requireValidType(body.type()));
        }
        if (body.amount() != null) {
            row.setAmount(body.amount());
        }
        if (body.date() != null) {
            row.setDate(body.date());
        }
        if (body.recurring() != null) {
            row.setRecurring(normaliseRecurring(body.recurring()));
        }
        // Free text: present-but-empty means "clear it", which is the only way a PATCH bound to a
        // record can express erasure (see TransactionUpdateRequest).
        if (body.category() != null) {
            row.setCategory(blankToNull(body.category()));
        }
        if (body.note() != null) {
            row.setNote(blankToNull(body.note()));
        }
        return mapper.toDto(transactions.save(row));
    }

    /** Soft delete: the row feeds totals the owner may have reconciled; losing it would shift past nets. */
    @Transactional
    public void deleteTransaction(UUID callerId, UUID propertyId, UUID txnId) {
        ownedPropertyId(callerId, propertyId);
        Transaction row = transactions.findLiveByIdAndPropertyId(txnId, propertyId)
                .orElseThrow(() -> NotFoundException.of("Transaction"));
        row.archive("Deleted by owner");
        transactions.save(row);
    }

    // ---- ownership basis ----

    /** {@code basis} is {@code null} when nothing is recorded: a normal state of a real listing, not a missing resource. */
    @Transactional(readOnly = true)
    public FinanceOverviewDto overview(UUID callerId, UUID propertyId, Integer months) {
        ownedPropertyId(callerId, propertyId);
        return new FinanceOverviewDto(
                bases.findById(propertyId).map(mapper::toDto).orElse(null),
                duesOf(propertyId),
                cashflowOf(propertyId, months));
    }

    /** Contract {@code setBasis} — upserts the basis. Keyed by property, so save is idempotent. */
    @Transactional
    public OwnershipBasisDto setBasis(UUID callerId, UUID propertyId, OwnershipBasisDto body) {
        ownedPropertyId(callerId, propertyId);
        OwnershipBasis basis = bases.findById(propertyId)
                .orElseGet(() -> new OwnershipBasis(propertyId, callerId));

        basis.setPurchasePrice(requireNonNegative(body.purchasePrice(), "purchasePrice"));
        basis.setPurchaseDate(body.purchaseDate());
        basis.setLoanOutstanding(requireNonNegative(body.loanOutstanding(), "loanOutstanding"));
        basis.setEmi(requireNonNegative(body.emi(), "emi"));
        basis.setCurrentValue(requireNonNegative(body.currentValue(), "currentValue"));
        return mapper.toDto(bases.save(basis));
    }

    // ---- aggregates ----

    /** Totals are summed in the database so a three-integer answer doesn't grow with the owner's history. */
    @Transactional(readOnly = true)
    public FinanceSummaryDto summary(UUID callerId, UUID propertyId, String period) {
        ownedPropertyId(callerId, propertyId);
        String window = period == null ? SummaryPeriods.ALL : period;
        if (!SummaryPeriods.isValid(window)) {
            throw new BadRequestException("Unknown period: " + window);
        }

        LocalDate today = todayIst();
        LocalDate from = SummaryPeriods.startOf(window, today);

        TransactionRepository.Totals totals = transactions.sumByTypeSince(propertyId, from);
        long income = totals.getIncome();
        long expense = totals.getExpense();

        return new FinanceSummaryDto(income, expense, income - expense,
                occupancyRate(propertyId, from, today));
    }

    /** Months with no activity are filled with zeros here, as a missing chart bar differs from a zero one. */
    private List<CashflowPointDto> cashflowOf(UUID propertyId, Integer months) {
        int window = months == null ? 12 : months;
        if (window < 1 || window > MAX_CASHFLOW_MONTHS) {
            throw new BadRequestException(
                    "months must be between 1 and " + MAX_CASHFLOW_MONTHS);
        }

        YearMonth thisMonth = currentMonthIst();
        YearMonth firstMonth = thisMonth.minusMonths(window - 1L);

        // Half-open [first day of the earliest month, first day of next month): the upper bound restates the series end,
        // as a post-dated row is legal and would otherwise aggregate months the loop never reads.
        Map<String, long[]> byMonth = new HashMap<>();
        for (Object[] row : transactions.monthlyTotalsBetween(
                propertyId, firstMonth.atDay(1), thisMonth.plusMonths(1).atDay(1))) {
            byMonth.put((String) row[0], new long[]{toLong(row[1]), toLong(row[2])});
        }

        List<CashflowPointDto> series = new ArrayList<>(window);
        for (int i = 0; i < window; i++) {
            YearMonth month = firstMonth.plusMonths(i);
            long[] totals = byMonth.getOrDefault(month.format(MONTH_KEY), new long[]{0L, 0L});
            series.add(new CashflowPointDto(month.format(MONTH_KEY), totals[0], totals[1],
                    totals[0] - totals[1]));
        }
        return series;
    }

    /** Sorted by {@code nextDue}, as "what do I owe next" is not the row recorded longest ago. */
    private List<DueDto> duesOf(UUID propertyId) {
        LocalDate today = todayIst();

        return transactions.findLiveRecurringByPropertyId(propertyId).stream()
                .map(row -> {
                    LocalDate nextDue = RecurringIntervals.nextOccurrenceOnOrAfter(
                            row.getDate(), row.getRecurring(), today);
                    return mapper.toDueDto(row, nextDue,
                            ChronoUnit.DAYS.between(today, nextDue));
                })
                .sorted((a, b) -> Long.compare(a.daysUntil(), b.daysUntil()))
                .toList();
    }

    // ---- internal helpers ----

    /** 404 if the property does not exist or is not theirs, never 403, which would confirm someone else's listing exists. */
    private void ownedPropertyId(UUID callerId, UUID propertyId) {
        if (properties.findByIdAndOwner_Id(propertyId, callerId).isEmpty()) {
            throw NotFoundException.of("Property");
        }
    }

    /** Null, not 0.0: zero asserts vacancy, null means not applicable (sale listing, owner-occupied).
     * Counts are half-open [start, end), so no {@code +1}; inclusive bounds would double-count changeover days. */
    private Double occupancyRate(UUID propertyId, LocalDate from, LocalDate today) {
        List<Tenancy> history = tenancies.findByPropertyId(propertyId);
        if (history.isEmpty()) {
            return null;
        }

        LocalDate windowStart = from != null ? from : earliestStart(history);
        if (windowStart == null || !windowStart.isBefore(today)) {
            return null;
        }
        long windowDays = ChronoUnit.DAYS.between(windowStart, today);

        long tenantedDays = 0;
        for (Tenancy tenancy : history) {
            LocalDate start = tenancy.getStartDate();
            if (start == null) {
                continue;
            }
            // An active tenancy with no end date runs to today; a terminal one ends when it ended.
            LocalDate end = tenancy.getEndDate() != null ? tenancy.getEndDate() : today;
            LocalDate overlapStart = start.isAfter(windowStart) ? start : windowStart;
            LocalDate overlapEnd = end.isBefore(today) ? end : today;
            if (overlapStart.isBefore(overlapEnd)) {
                tenantedDays += ChronoUnit.DAYS.between(overlapStart, overlapEnd);
            }
        }
        // Clamp: overlapping historical rows (possible before the old V12's unique index existed) must not
        // produce a rate above 1.0, which would read as more than fully occupied.
        return Math.min(1.0, (double) tenantedDays / windowDays);
    }

    private static LocalDate earliestStart(List<Tenancy> history) {
        return history.stream()
                .map(Tenancy::getStartDate)
                .filter(d -> d != null)
                .min(LocalDate::compareTo)
                .orElse(null);
    }

    private static String requireValidType(String type) {
        if (!TransactionTypes.isValid(type)) {
            throw new BadRequestException(
                    "type must be one of: " + TransactionTypes.INCOME + ", "
                            + TransactionTypes.EXPENSE);
        }
        return type;
    }

    private static String normaliseRecurring(String recurring) {
        if (recurring == null) {
            return RecurringIntervals.NONE;
        }
        if (!RecurringIntervals.isValid(recurring)) {
            throw new BadRequestException("Unknown recurring interval: " + recurring);
        }
        return recurring;
    }

    /** Money fields may be absent but not negative: amounts are unsigned platform-wide. */
    private static Long requireNonNegative(Long value, String field) {
        if (value != null && value < 0) {
            throw new BadRequestException(field + " must not be negative");
        }
        return value;
    }

    private static String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static long toLong(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }
}
