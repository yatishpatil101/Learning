package com.punenest.api.finance.ledger;

import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.finance.tenancy.Tenancy;
import com.punenest.api.finance.tenancy.TenancyRepository;
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

/**
 * The owner's property finance ledger: transactions, ownership basis, and the three aggregates
 * computed from them (summary, cashflow, dues).
 *
 * <p><strong>Owner-only, 404 never 403.</strong> Every operation resolves the property through
 * {@link #ownedPropertyId}, which fails with 404 when the listing does not exist <em>or</em> is not
 * the caller's. The two cases are deliberately indistinguishable: a 403 would confirm that a
 * property id is real and has an owner who is not you, which is a fact about someone else's assets
 * that the caller has no right to learn. A finance ledger is the most private thing on the
 * platform — what an owner paid, what they owe, what they earn — so this is the endpoint family
 * where that distinction matters most.
 *
 * <p><strong>Category is free text, deliberately</strong> (design decision D3). V6 stores
 * {@code category text} with no CHECK and the contract types it as a plain string with an example
 * rather than an enum. The frontend already ships two lists of display labels ("Society
 * maintenance", "Home loan EMI", …) that a server-side vocabulary would have to duplicate exactly
 * or start rejecting the UI's own values — and an owner with a category the product never thought
 * of ("Diwali society contribution") is describing their own money accurately. The server trims it,
 * caps its length, and otherwise stays out of the way. Aggregation never depends on the category,
 * so an unrecognised one cannot corrupt a total.
 *
 * <p><strong>The loan's rate and tenure are not stored</strong> (D5). The mock persists them
 * alongside the basis, but only to feed a browser-side EMI calculator that recomputes from the
 * user's live input on every keystroke. The figure the platform actually uses — the monthly
 * instalment — is {@code ownership_basis.emi}. Storing the inputs to a calculation nothing reads
 * back is how a schema fills with fields whose meaning nobody can reconstruct a year later.
 *
 * <p><strong>Expense breakdown and CSV/PDF export stay on the client</strong> (D5). The breakdown
 * is a group-by of rows the client has already fetched, and the exports are rendered in the browser
 * with jsPDF. Neither needs a server round trip, and adding endpoints for them would create a
 * second implementation of a total the client can already compute — the same ruling as slice 3's
 * {@code pendingContactCount}.
 */
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

    /**
     * Contract {@code updateTransaction} — a genuine partial update (spec fix S19). An absent field
     * is left alone; an empty string clears the two free-text fields.
     *
     * @throws NotFoundException when the row does not exist, is archived, or belongs to another
     *                           property — again indistinguishable, for the same reason
     */
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

    /**
     * Contract {@code deleteTransaction} — soft-deletes one row. Returns 204.
     *
     * <p>Soft, not hard: this row is part of a total the owner has already seen and may have
     * reconciled against a bank statement. Losing it would change last month's net with nothing
     * left to explain the difference.
     */
    @Transactional
    public void deleteTransaction(UUID callerId, UUID propertyId, UUID txnId) {
        ownedPropertyId(callerId, propertyId);
        Transaction row = transactions.findLiveByIdAndPropertyId(txnId, propertyId)
                .orElseThrow(() -> NotFoundException.of("Transaction"));
        row.archive("Deleted by owner");
        transactions.save(row);
    }

    // ---- ownership basis ----

    /**
     * Contract {@code getBasis} — the property's purchase/valuation figures.
     *
     * <p>Returns an all-null shape rather than a 404 when nothing has been recorded. "This owner
     * has not filled in their basis yet" is a normal, expected state of a real listing, not a
     * missing resource, and a 404 would force every caller to treat an empty form as an error.
     */
    @Transactional(readOnly = true)
    public OwnershipBasisDto getBasis(UUID callerId, UUID propertyId) {
        ownedPropertyId(callerId, propertyId);
        return bases.findById(propertyId)
                .map(mapper::toDto)
                .orElseGet(() -> new OwnershipBasisDto(null, null, null, null, null));
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

    /**
     * Contract {@code financeSummary} — income, expense and net over a window, plus occupancy.
     *
     * <p>The totals are summed in the database: pulling a year of rows into the JVM to add up two
     * numbers makes the cost of a three-integer answer grow with the owner's history.
     */
    @Transactional(readOnly = true)
    public FinanceSummaryDto summary(UUID callerId, UUID propertyId, String period) {
        ownedPropertyId(callerId, propertyId);
        String window = period == null ? SummaryPeriods.ALL : period;
        if (!SummaryPeriods.isValid(window)) {
            throw new BadRequestException("Unknown period: " + window);
        }

        LocalDate today = LocalDate.now();
        LocalDate from = SummaryPeriods.startOf(window, today);

        TransactionRepository.Totals totals = transactions.sumByTypeSince(propertyId, from);
        long income = totals.getIncome();
        long expense = totals.getExpense();

        return new FinanceSummaryDto(income, expense, income - expense,
                occupancyRate(propertyId, from, today));
    }

    /**
     * Contract {@code financeCashflow} — a monthly income/expense series ending with this month.
     *
     * <p>Months with no activity are emitted as zeros. The database only returns months that have
     * rows, and a chart with a missing bar is a different picture from one with a zero bar — the
     * gaps are filled here because only this method knows how many months were asked for.
     */
    @Transactional(readOnly = true)
    public List<CashflowPointDto> cashflow(UUID callerId, UUID propertyId, Integer months) {
        ownedPropertyId(callerId, propertyId);
        int window = months == null ? 12 : months;
        if (window < 1 || window > MAX_CASHFLOW_MONTHS) {
            throw new BadRequestException(
                    "months must be between 1 and " + MAX_CASHFLOW_MONTHS);
        }

        YearMonth thisMonth = YearMonth.now();
        YearMonth firstMonth = thisMonth.minusMonths(window - 1L);

        Map<String, long[]> byMonth = new HashMap<>();
        for (Object[] row : transactions.monthlyTotalsSince(propertyId, firstMonth.atDay(1))) {
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

    /**
     * Contract {@code financeDues} — recurring rows projected to their next occurrence, soonest
     * first (spec fix S14).
     *
     * <p>Sorted by {@code nextDue} rather than by the anchor date: the question this endpoint
     * answers is "what do I owe next", and the row recorded longest ago is not the one falling due
     * soonest.
     */
    @Transactional(readOnly = true)
    public List<DueDto> dues(UUID callerId, UUID propertyId) {
        ownedPropertyId(callerId, propertyId);
        LocalDate today = LocalDate.now();

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

    /**
     * Verify the caller owns the property. 404 if it does not exist <em>or</em> is not theirs —
     * never 403, which would confirm the existence of someone else's listing.
     */
    private void ownedPropertyId(UUID callerId, UUID propertyId) {
        if (properties.findByIdAndOwner_Id(propertyId, callerId).isEmpty()) {
            throw NotFoundException.of("Property");
        }
    }

    /**
     * Fraction of the window covered by an active tenancy, or {@code null} if the property has
     * never had one (spec fix S20).
     *
     * <p>Null rather than {@code 0.0} because they say different things. Zero asserts "vacant the
     * whole time", which is a judgement about a property that was let badly; null says the question
     * does not apply — this is a sale listing, or the owner lives in it. An owner comparing two
     * flats should not see a flat they live in scored as 0% occupied.
     *
     * <p>For the all-time window the denominator starts at the earliest tenancy, since occupancy
     * before the first tenant existed is not a meaningful vacancy.
     *
     * <p><strong>Both counts are half-open {@code [start, end)} and must stay that way.</strong>
     * {@code DAYS.between(1 Jan, 1 Feb)} is 31, which is exactly the days in January, so no
     * {@code +1} is missing. Making either bound inclusive would double-count the changeover day
     * where one tenancy ends and the next begins, and could push a fully-let flat above 100%.
     */
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
        // Clamp: overlapping historical rows (possible before V12's unique index existed) must not
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

    /**
     * Money fields on the basis may be absent, but not negative. A negative purchase price or
     * outstanding loan is not a bookkeeping convention here — amounts are unsigned platform-wide
     * and direction is carried by other means.
     */
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
