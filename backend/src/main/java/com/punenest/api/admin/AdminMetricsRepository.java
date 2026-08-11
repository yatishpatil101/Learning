package com.punenest.api.admin;

import com.punenest.api.common.PlatformTime;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.time.LocalDate;import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/**
 * Every aggregate the back-office dashboards read, as native SQL.
 *
 * <p><strong>Why native SQL and not the other contexts' repositories.</strong> Two reasons, and the
 * second is the one that decided it.
 *
 * <ol>
 *   <li>JPQL cannot bucket by time. {@code date_trunc} is the whole of the analytics endpoint and
 *       has no portable equivalent; emulating it in Java means loading every row in the range to
 *       count them, which is the one thing an analytics query must not do.
 *   <li>Injecting seven repositories from six bounded contexts would put a real Java dependency
 *       from {@code admin} onto every one of them, and each would then grow a {@code countBy…}
 *       method that exists only for this screen. Reading the tables instead leaves {@code admin}
 *       with <em>zero</em> cross-context imports: it depends on the schema, which Flyway owns and
 *       {@code ArchitectureBoundaryTest} was never trying to protect.
 * </ol>
 *
 * <p>The cost is real and worth naming: a column rename in another context breaks this class at
 * runtime rather than at compile time. The endpoint tests are what catch it, which is why every
 * query here has one.
 *
 * <p><strong>All time bucketing is done in IST.</strong> {@code date_trunc} on a {@code timestamptz}
 * uses the session time zone, so on a UTC server "yesterday" would end at 05:30 IST and every daily
 * chart would be sheared by five and a half hours. Converting explicitly makes the answer the same
 * whatever the server is set to.
 */
@Repository
public class AdminMetricsRepository {

    /**
     * The zone every calendar bucket is cut in. See the class Javadoc.
     *
     * <p>Spelled as a string because it is interpolated into SQL, where a Java constant cannot be
     * named — but <em>derived</em> from {@link PlatformTime#IST} rather than written out again, so
     * this is a projection of the shared constant and not a fourth copy of it (tech debt D179). If
     * the platform's reckoning zone ever moves, this moves with it instead of silently disagreeing
     * with {@link AdminMetricsService}, which cuts the window edges these buckets sit inside.
     */
    private static final String IST = PlatformTime.IST.getId();

    /**
     * Revenue, per source, over an optional date window.
     *
     * <p>Each source is counted only where there is an <em>unambiguous</em> marker that money
     * arrived, because two of the three status vocabularies cannot tell a paid row from an
     * abandoned one on their own:
     *
     * <ul>
     *   <li><strong>rent</strong> — {@code platform_fee} on a {@code paid} payment. The rent itself
     *       is the landlord's; GST is the government's. Only the fee is the platform's.
     *   <li><strong>subscriptions</strong> — a priced plan ({@code payment_ref} is only set when an
     *       order was opened) that left {@code pending} (only the webhook does that). A row later
     *       {@code cancelled} because it was superseded by an upgrade still counts, correctly: it
     *       was paid for.
     *   <li><strong>boosts</strong> — {@code paid_at} is set by {@code activate} only when a
     *       payment webhook confirms receipt of funds (D64). Free packs and any future comp/grant
     *       activations leave it null, so they are correctly excluded from revenue.
     * </ul>
     *
     * <p><strong>Service orders are deliberately absent.</strong> {@code service_orders.amount} is
     * a quote, not a receipt — the marketplace takes no money through the gateway — so folding it
     * in would report revenue the platform has not received.
     */
    private static final String REVENUE_BY_SOURCE = """
            select 'rent' as source, coalesce(sum(rp.platform_fee), 0) as amount
              from rent_payments rp
             where rp.status = 'paid'
               and (cast(:from as date) is null or rp.paid_date >= cast(:from as date))
               and (cast(:to   as date) is null or rp.paid_date <  cast(:to   as date))
            union all
            select 'subscriptions', coalesce(sum(p.price), 0)
              from subscriptions s
              join plans p on p.id = s.plan_id
             where s.payment_ref is not null
               and s.status <> 'pending'
               and (cast(:from as date) is null
                    or (s.started_at at time zone '%1$s') >= cast(:from as date))
               and (cast(:to   as date) is null
                    or (s.started_at at time zone '%1$s') <  cast(:to   as date))
            union all
            select 'boosts', coalesce(sum(bp.price), 0)
              from boosts b
              join boost_packs bp on bp.id = b.pack_id
             where b.paid_at is not null
               and (cast(:from as date) is null
                    or (b.paid_at at time zone '%1$s') >= cast(:from as date))
               and (cast(:to   as date) is null
                    or (b.paid_at at time zone '%1$s') <  cast(:to   as date))
            """.formatted(IST);

    /**
     * The same three sources, bucketed. Shares its predicates with {@link #REVENUE_BY_SOURCE}.
     *
     * <p>{@code rent_payments.paid_date} is the one column here that is <em>not</em> converted, and
     * that is correct rather than an oversight: it is a {@code date}, not a {@code timestamptz}. It
     * was written as {@code LocalDate.now(IST)} by the payment webhook, so it already <em>is</em>
     * the IST calendar day, and {@code timestamp} carries no zone for a conversion to act on.
     * Casting it through {@code timestamptz} to "fix" it would apply the session offset to a value
     * that never had one and shift half the payments into the previous day.
     */
    private static final String REVENUE_SERIES = """
            select bucket, sum(amount) as amount from (
                select date_trunc(:interval, cast(rp.paid_date as timestamp)) as bucket,
                       rp.platform_fee as amount
                  from rent_payments rp
                 where rp.status = 'paid'
                   and rp.paid_date >= cast(:from as date)
                   and rp.paid_date <  cast(:to   as date)
                union all
                select date_trunc(:interval, s.started_at at time zone '%1$s'), p.price
                  from subscriptions s
                  join plans p on p.id = s.plan_id
                 where s.payment_ref is not null
                   and s.status <> 'pending'
                   and (s.started_at at time zone '%1$s') >= cast(:from as date)
                   and (s.started_at at time zone '%1$s') <  cast(:to   as date)
                union all
                select date_trunc(:interval, b.paid_at at time zone '%1$s'), bp.price
                  from boosts b
                  join boost_packs bp on bp.id = b.pack_id
                 where b.paid_at is not null
                   and (b.paid_at at time zone '%1$s') >= cast(:from as date)
                   and (b.paid_at at time zone '%1$s') <  cast(:to   as date)
            ) parts
            group by bucket
            order by bucket
            """.formatted(IST);

    /**
     * Counts bucketed by a timestamp column.
     *
     * <p>Format arguments, in order: the zone, the table, the row filter, the timestamp column.
     */
    private static final String COUNT_SERIES = """
            select date_trunc(:interval, t.%4$s at time zone '%1$s') as bucket, count(*) as amount
              from %2$s t
             where %3$s
               and (t.%4$s at time zone '%1$s') >= cast(:from as date)
               and (t.%4$s at time zone '%1$s') <  cast(:to   as date)
             group by bucket
             order by bucket
            """;

    private final EntityManager em;

    public AdminMetricsRepository(EntityManager em) {
        this.em = em;
    }

    /** Listings that are not soft-deleted, optionally narrowed to one moderation status. */
    public long countListings(String status) {
        String sql = "select count(*) from properties where archived = false"
                + (status == null ? "" : " and status = :status");
        Query query = em.createNativeQuery(sql);
        if (status != null) {
            query.setParameter("status", status);
        }
        return ((Number) query.getSingleResult()).longValue();
    }

    /** Users that are not soft-deleted, optionally only those who joined within {@code days}. */
    public long countUsers(Integer withinDays) {
        String sql = "select count(*) from users where archived = false"
                + (withinDays == null ? ""
                        : " and (joined_at at time zone '" + IST + "') >= "
                                + "(now() at time zone '" + IST + "') - make_interval(days => :d)");
        Query query = em.createNativeQuery(sql);
        if (withinDays != null) {
            query.setParameter("d", withinDays);
        }
        return ((Number) query.getSingleResult()).longValue();
    }

    /** Deals that reached {@code closed} within the last {@code days}. */
    public long countDealsClosed(int withinDays) {
        Query query = em.createNativeQuery("""
                select count(*) from deals
                 where status = 'closed'
                   and closed_at is not null
                   and closed_at >= now() - make_interval(days => :d)
                """);
        query.setParameter("d", withinDays);
        return ((Number) query.getSingleResult()).longValue();
    }

    /**
     * Rent the platform has collected and still owes landlords.
     *
     * <p>The gross rent, not the fee: the fee is the platform's and is already counted as revenue.
     */
    public long payoutsDue() {
        return ((Number) em.createNativeQuery(
                "select coalesce(sum(amount), 0) from rent_payments where status = 'paid'")
                .getSingleResult()).longValue();
    }

    /**
     * Revenue split by source over {@code [from, to)}; either bound may be null for "all time".
     *
     * @return source name to whole rupees, always containing all three sources
     */
    @SuppressWarnings("unchecked")
    public Map<String, Long> revenueBySource(LocalDate from, LocalDate to) {
        List<Object[]> rows = em.createNativeQuery(REVENUE_BY_SOURCE)
                .setParameter("from", from)
                .setParameter("to", to)
                .getResultList();
        return rows.stream().collect(java.util.stream.Collectors.toMap(
                row -> (String) row[0],
                row -> ((Number) row[1]).longValue()));
    }

    /** Bucketed revenue over {@code [from, to)}. Buckets with no money simply do not appear. */
    @SuppressWarnings("unchecked")
    public List<Object[]> revenueSeries(String interval, LocalDate from, LocalDate to) {
        return em.createNativeQuery(REVENUE_SERIES)
                .setParameter("interval", interval)
                .setParameter("from", from)
                .setParameter("to", to)
                .getResultList();
    }

    /**
     * Bucketed counts for one of the three count metrics.
     *
     * <p>{@code table}, {@code where} and {@code column} are chosen from a fixed set by
     * {@link AdminMetricsService} and never come from the request — the request only picks which
     * metric, and an unrecognised metric is refused before it reaches here.
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> countSeries(String table, String column, String where, String interval,
            LocalDate from, LocalDate to) {
        String sql = COUNT_SERIES.formatted(IST, table, where, column);
        return em.createNativeQuery(sql)
                .setParameter("interval", interval)
                .setParameter("from", from)
                .setParameter("to", to)
                .getResultList();
    }
}
