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
     * arrived, because neither status vocabulary can tell a paid row from an abandoned one on its
     * own:
     *
     * <ul>
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
     *
     * <p><strong>Rent is absent because the platform does not collect it.</strong> There is no
     * online rent rail; {@code /pay-rent} is a coming-soon page. A rent band here would be a
     * permanent zero that reads as a bad quarter rather than as an absent product.
     */
    private static final String REVENUE_BY_SOURCE = """
            select 'subscriptions' as source, coalesce(sum(p.price), 0) as amount
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
     * The same two sources, bucketed. Shares its predicates with {@link #REVENUE_BY_SOURCE}.
     */
    private static final String REVENUE_SERIES = """
            select bucket, sum(amount) as amount from (
                select date_trunc(:interval, s.started_at at time zone '%1$s') as bucket, p.price as amount
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

    /**
     * The same two sources as {@link #REVENUE_SERIES}, bucketed but <em>not</em> summed together.
     *
     * <p><strong>Why a second query rather than a parameter on the first.</strong> The existing one
     * feeds {@code /admin/analytics?metric=revenue}, which is staff-visible and charts a single
     * line. Teaching it to emit a source column would change that operation's shape for every
     * caller in order to serve one screen, and the revenue <em>mix</em> is exactly the thing
     * {@code /admin/finance} is admin-only to protect. The predicates are shared by being written
     * the same way, and the pair is pinned together by a test that asserts the totals agree — which
     * is the only guarantee that matters and the one a shared string could not give on its own.
     *
     * <p>Buckets with no money in a given source simply do not appear; the service fills the gaps,
     * because a missing bucket and a zero bucket are the same fact here and only one of them
     * renders as a chart the reader can trust.
     */
    private static final String REVENUE_SERIES_BY_SOURCE = """
            select bucket, source, sum(amount) as amount from (
                select date_trunc(:interval, s.started_at at time zone '%1$s') as bucket,
                       'subscriptions' as source, p.price as amount
                  from subscriptions s
                  join plans p on p.id = s.plan_id
                 where s.payment_ref is not null
                   and s.status <> 'pending'
                   and (s.started_at at time zone '%1$s') >= cast(:from as date)
                   and (s.started_at at time zone '%1$s') <  cast(:to   as date)
                union all
                select date_trunc(:interval, b.paid_at at time zone '%1$s'), 'boosts', bp.price
                  from boosts b
                  join boost_packs bp on bp.id = b.pack_id
                 where b.paid_at is not null
                   and (b.paid_at at time zone '%1$s') >= cast(:from as date)
                   and (b.paid_at at time zone '%1$s') <  cast(:to   as date)
            ) parts
            group by bucket, source
            order by bucket, source
            """.formatted(IST);

    /**
     * Monthly recurring revenue: what the active subscription book bills in a typical month.
     *
     * <p><strong>Normalised per row, not per total.</strong> A yearly plan contributes a twelfth of
     * its price and a quarterly plan a third, rounded to the rupee at each row. Rounding the sum
     * instead would be marginally more accurate and would stop the figure agreeing with the
     * per-plan breakdown printed beside it on the same screen — and two numbers on one card that do
     * not add up costs more trust than a rupee of precision buys.
     *
     * <p><strong>Free plans are excluded by {@code price > 0}, not by name.</strong> Owner Free is a
     * real subscription row and a real active plan; it is simply not revenue. Filtering on the price
     * rather than on the plan's title means a promotional zero-rupee plan is handled correctly on
     * the day it is created, with no list to remember to update.
     *
     * <p><strong>{@code status = 'active'} here, where the revenue queries say
     * {@code status <> 'pending'}.</strong> That difference is the whole distinction between the two
     * questions. Revenue is historical and a cancelled subscription still earned what it earned;
     * MRR is a forward-looking run rate and a cancelled subscription bills nothing next month.
     */
    private static final String MRR = """
            select coalesce(sum(
                     case coalesce(p.billing_cycle, 'monthly')
                       when 'monthly'   then p.price
                       when 'quarterly' then round(p.price / 3.0)
                       when 'yearly'    then round(p.price / 12.0)
                       else p.price
                     end), 0)::bigint
              from subscriptions s
              join plans p on p.id = s.plan_id
             where s.status = 'active'
               and s.payment_ref is not null
               and p.price > 0
            """;

    /** The same book as {@link #MRR}, itemised. Same filters, so the lines sum to the total. */
    private static final String PLAN_LINES = """
            select p.name, p.audience, coalesce(p.billing_cycle, 'monthly'), p.price,
                   count(*) as active,
                   coalesce(sum(
                     case coalesce(p.billing_cycle, 'monthly')
                       when 'monthly'   then p.price
                       when 'quarterly' then round(p.price / 3.0)
                       when 'yearly'    then round(p.price / 12.0)
                       else p.price
                     end), 0)::bigint as monthly
              from subscriptions s
              join plans p on p.id = s.plan_id
             where s.status = 'active'
               and s.payment_ref is not null
               and p.price > 0
             group by p.id, p.name, p.audience, p.billing_cycle, p.price
             order by p.name
            """;

    /**
     * Distinct people who paid the platform anything inside the window.
     *
     * <p>The denominator of ARPPU, and deliberately a different question from {@code countUsers} —
     * which is the denominator of ARPU. Both are served, because the two answer different questions
     * and a console that prints only one of them invites the reader to assume it is the other.
     *
     * <p>{@code union}, not {@code union all}: somebody who subscribed and bought a boost in the
     * same month is one paying customer, and counting them twice would deflate ARPPU exactly where
     * the business is doing well.
     */
    private static final String PAYING_USERS = """
            select count(*) from (
                select s.user_id as uid
                  from subscriptions s
                  join plans p on p.id = s.plan_id
                 where s.payment_ref is not null
                   and s.status <> 'pending'
                   and p.price > 0
                   and (s.started_at at time zone '%1$s') >= cast(:from as date)
                   and (s.started_at at time zone '%1$s') <  cast(:to   as date)
                union
                select b.buyer_id
                  from boosts b
                 where b.paid_at is not null
                   and (b.paid_at at time zone '%1$s') >= cast(:from as date)
                   and (b.paid_at at time zone '%1$s') <  cast(:to   as date)
            ) payers
             where uid is not null
            """.formatted(IST);

    /**
     * The settlement ledger, and the count that pages it.
     *
     * <p><strong>Two sources, one settlement vocabulary.</strong> The underlying tables speak two
     * different status languages — {@code active/past-due/cancelled/expired} and
     * {@code active/expired} — and neither is about settlement. A subscription that is
     * {@code cancelled} was still paid for; a boost that is {@code expired} was still bought. So the
     * ledger derives the only status a finance reader is asking about, which is whether the money
     * arrived: {@code paid}, {@code pending} or {@code failed}.
     *
     * <p><strong>{@code refunded} is deliberately not in that vocabulary.</strong> The platform has
     * no refund path, so a ledger that offered the value would be advertising a state no row can
     * ever hold — which is the disclosure {@code refundsMeasured} exists to make, and it must not be
     * contradicted two panels away.
     *
     * <p>Format argument: the row filter, so the page and its count cannot drift apart.
     */
    private static final String LEDGER_ROWS = """
            select s.id as id,
                   cast((s.started_at at time zone '%1$s') as date) as occurred_on,
                   coalesce(u.name, 'Member') as party,
                   'subscription' as kind,
                   p.price as amount,
                   case when s.payment_ref is not null and s.status <> 'pending'
                        then 'paid' else 'pending' end as settlement
              from subscriptions s
              join plans p on p.id = s.plan_id
              left join users u on u.id = s.user_id
             where p.price > 0
            union all
            select b.id,
                   cast((coalesce(b.paid_at, b.starts_at) at time zone '%1$s') as date),
                   coalesce(u.name, 'Owner'),
                   'featured',
                   bp.price,
                   case when b.paid_at is not null then 'paid' else 'pending' end
              from boosts b
              join boost_packs bp on bp.id = b.pack_id
              left join users u on u.id = b.buyer_id
            """.formatted(IST);

    /**
     * The filter applied to {@link #LEDGER_ROWS}, written once and used by both the page and its
     * count.
     *
     * <p>Every bound parameter is {@code cast(… as text)} before the null test. A bare
     * {@code :kind is null} leaves Postgres with no known type on either side and fails the
     * <em>whole</em> statement rather than the predicate — the same landmine JPQL hits, and native
     * SQL is not exempt from it.
     */
    private static final String LEDGER_FILTER = """
             where (cast(:kind       as text) is null or kind       = cast(:kind       as text))
               and (cast(:settlement as text) is null or settlement = cast(:settlement as text))
               and (cast(:q          as text) is null or party ilike cast(:q as text) escape '\\')
            """;

    /**
     * The ledger's columns, named rather than starred.
     *
     * <p>{@link AdminMetricsService} maps this result positionally, so {@code select *} would make
     * the mapping depend on the declaration order inside two separate {@code union all} branches.
     * Adding a column to one of them would then shift every index — and a {@code ClassCastException}
     * is the <em>lucky</em> outcome, because {@code party} and {@code kind} are both text and would
     * simply swap.
     */
    private static final String LEDGER_PROJECTION =
            "select id, occurred_on, party, kind, amount, settlement from ";

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
     * Revenue split by source over {@code [from, to)}; either bound may be null for "all time".
     *
     * @return source name to whole rupees, always containing both sources
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

    /**
     * Bucketed revenue over {@code [from, to)}, one row per (bucket, source).
     *
     * @return rows of {@code [bucket, source, amount]}; absent pairs mean zero
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> revenueSeriesBySource(String interval, LocalDate from, LocalDate to) {
        return em.createNativeQuery(REVENUE_SERIES_BY_SOURCE)
                .setParameter("interval", interval)
                .setParameter("from", from)
                .setParameter("to", to)
                .getResultList();
    }

    /** Monthly run rate of the active subscription book, in whole rupees. See {@link #MRR}. */
    public long mrr() {
        return ((Number) em.createNativeQuery(MRR).getSingleResult()).longValue();
    }

    /**
     * The active subscription book, itemised per plan.
     *
     * @return rows of {@code [name, audience, billingCycle, price, activeCount, monthlyValue]}
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> subscriptionPlanLines() {
        return em.createNativeQuery(PLAN_LINES).getResultList();
    }

    /** Distinct people who paid the platform anything in {@code [from, to)}. */
    public long payingUsers(LocalDate from, LocalDate to) {
        return ((Number) em.createNativeQuery(PAYING_USERS)
                .setParameter("from", from)
                .setParameter("to", to)
                .getSingleResult()).longValue();
    }

    /**
     * One page of the settlement ledger, newest first.
     *
     * <p>Ordered by {@code occurred_on desc} with {@code id} breaking ties. The tiebreak is not
     * decoration: two unioned sources routinely produce several rows on one date, and without a
     * total order a row can appear on two consecutive pages while another appears on neither.
     *
     * @param kind {@code subscription}, {@code featured}, or null for all
     * @param settlement {@code paid}, {@code pending}, {@code failed}, or null for all
     * @param q a party-name substring, already wrapped in {@code %}, or null
     * @return rows of {@code [id, occurredOn, party, kind, amount, settlement]}
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> ledger(String kind, String settlement, String q, int limit, long offset) {
        return em.createNativeQuery(LEDGER_PROJECTION + "(" + LEDGER_ROWS + ") ledger"
                + LEDGER_FILTER
                + " order by occurred_on desc nulls last, id limit :limit offset :offset")
                .setParameter("kind", kind)
                .setParameter("settlement", settlement)
                .setParameter("q", q)
                .setParameter("limit", limit)
                .setParameter("offset", offset)
                .getResultList();
    }

    /** How many rows {@link #ledger} would return unpaged, for the page envelope. */
    public long ledgerCount(String kind, String settlement, String q) {
        return ((Number) em.createNativeQuery(
                "select count(*) from (" + LEDGER_ROWS + ") ledger" + LEDGER_FILTER)
                .setParameter("kind", kind)
                .setParameter("settlement", settlement)
                .setParameter("q", q)
                .getSingleResult()).longValue();
    }
}
