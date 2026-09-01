package com.punenest.api.finance.ledger;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Access to {@code transactions}. Every query excludes soft-deleted rows so it can use the partial
 * indexes ({@code idx_transactions_property_agg}, {@code idx_transactions_recurring}), which are
 * themselves defined {@code WHERE archived = false}.
 *
 * <p>Reads are scoped by {@code propertyId} rather than {@code ownerId}: the controller has already
 * proved the caller owns the property, and scoping on the property alone lets the query ride the
 * property index and keeps the ledger complete when a listing's basis was recorded under a
 * different owner id.
 *
 * <p><strong>The aggregates are computed in the database, not in Java.</strong> Summing a year of
 * rows in the JVM means transferring every one of them to add up two numbers; it also makes the
 * response size grow with history for an endpoint whose answer is three integers.
 *
 * <p><strong>And they are answered from the index, not the table</strong> (tech debt D132). The old
 * V51 replaced the old V12's {@code (property_id, date)} index with one carrying {@code type} and
 * {@code amount} in its payload, which is everything the two aggregates below read. Finding the
 * rows was never the expensive part — visiting the heap once per row to add them up was, and that
 * cost grew with every rent cycle the owner ever recorded. Keep it that way: a filter or a sum on
 * a column outside {@code (property_id, date, type, amount)} silently puts the heap fetches back.
 */
public interface TransactionRepository extends JpaRepository<Transaction, UUID> {

    /**
     * Live rows for one property, newest first — the ledger list.
     *
     * <p>Paged: a property's ledger accrues rows on a schedule (rent, maintenance, recurring
     * expenses) and is never culled, so its size tracks how long the property has been held rather
     * than anything the caller did (api-standards.md §5.1).
     */
    @Query(value = "select t from Transaction t where t.propertyId = :propertyId and t.archived = false "
            + "order by t.date desc, t.createdAt desc",
            countQuery = "select count(t) from Transaction t where t.propertyId = :propertyId "
                    + "and t.archived = false")
    Page<Transaction> findLiveByPropertyId(@Param("propertyId") UUID propertyId, Pageable pageable);

    /** One live row, scoped to its property — the check every write performs. */
    @Query("select t from Transaction t where t.id = :id and t.propertyId = :propertyId "
            + "and t.archived = false")
    Optional<Transaction> findLiveByIdAndPropertyId(@Param("id") UUID id,
                                                    @Param("propertyId") UUID propertyId);

    /** Live recurring rows for one property — the dues projection. Rides {@code idx_transactions_recurring}. */
    @Query("select t from Transaction t where t.propertyId = :propertyId and t.archived = false "
            + "and t.recurring <> 'none' order by t.date")
    List<Transaction> findLiveRecurringByPropertyId(@Param("propertyId") UUID propertyId);

    /**
     * Income and expense totals for a window, as a single row.
     *
     * <p>{@code from} is nullable so the "all time" window needs no second query: a null lower
     * bound matches every row, which is what "all" means. {@code coalesce} turns the empty-window
     * {@code null} into {@code 0} so the caller never has to distinguish "no rows" from "no total".
     *
     * <p>The {@code cast} is load-bearing, not decoration. Written as a bare {@code :from is null},
     * Postgres cannot infer a type for the parameter — both sides of the comparison are unknown —
     * and fails the whole statement with "could not determine data type of parameter $2". Naming
     * the type in the cast gives the driver something to bind against.
     *
     * <p>Returns a projection rather than an {@code Object[]}. A multi-column query is a
     * {@code List<Object[]>} to Spring Data, so declaring the return as {@code Object[]} hands back
     * a one-element array <em>containing</em> the row — and the mistake only surfaces at runtime as
     * a {@code ClassCastException} on the first element.
     */
    @Query("select "
            + "coalesce(sum(case when t.type = 'income' then t.amount else 0 end), 0) as income, "
            + "coalesce(sum(case when t.type = 'expense' then t.amount else 0 end), 0) as expense "
            + "from Transaction t where t.propertyId = :propertyId and t.archived = false "
            + "and (cast(:from as LocalDate) is null or t.date >= :from)")
    Totals sumByTypeSince(@Param("propertyId") UUID propertyId, @Param("from") LocalDate from);

    /** Income and expense over one window, both whole rupees and never null (see the coalesce). */
    interface Totals {

        /** Total money in, whole INR. */
        long getIncome();

        /** Total money out, whole INR. */
        long getExpense();
    }

    /**
     * Monthly income/expense totals over a half-open window — the cashflow series, grouped in the
     * database so one query answers a twelve-month chart.
     *
     * <p>Months with no activity simply do not appear; the service fills the gaps, because a chart
     * with a missing bar and a chart with a zero bar are different pictures and only the service
     * knows which months were asked for.
     *
     * <p><strong>{@code toExclusive} is not redundant with the caller's loop.</strong>
     * {@link TransactionCreateRequest} deliberately allows a future date — next month's EMI, a
     * post-dated cheque — so a real ledger contains rows beyond the last month the chart draws.
     * Without the upper bound the database groups and sums those rows and the service throws the
     * buckets away, which is work paid for on every request and unbounded in the one direction
     * nothing prunes. Bounding it also lets the index range scan stop at the window's end instead
     * of running to the end of the property's history.
     *
     * <p>Half-open {@code [from, toExclusive)}, so the caller passes the first day of the month
     * <em>after</em> the last one it wants. An inclusive upper bound would need the last day of a
     * month, which is the calculation that gets February wrong.
     *
     * <p>Grouping is on {@code to_char(date, 'YYYY-MM')} and {@code date} is a {@code date}
     * column — no time, no zone, no conversion — so the month a row lands in is a property of the
     * value the owner entered and cannot shift with the server's timezone.
     *
     * @return rows of {@code [yyyy-mm, income, expense]}
     */
    @Query("select function('to_char', t.date, 'YYYY-MM'), "
            + "coalesce(sum(case when t.type = 'income' then t.amount else 0 end), 0), "
            + "coalesce(sum(case when t.type = 'expense' then t.amount else 0 end), 0) "
            + "from Transaction t where t.propertyId = :propertyId and t.archived = false "
            + "and t.date >= :from and t.date < :toExclusive "
            + "group by function('to_char', t.date, 'YYYY-MM') "
            + "order by function('to_char', t.date, 'YYYY-MM')")
    List<Object[]> monthlyTotalsBetween(@Param("propertyId") UUID propertyId,
                                        @Param("from") LocalDate from,
                                        @Param("toExclusive") LocalDate toExclusive);
}
