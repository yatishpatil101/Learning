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

    /**
     * The same three sources as {@link #REVENUE_SERIES}, bucketed but <em>not</em> summed together.
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
                select date_trunc(:interval, cast(rp.paid_date as timestamp)) as bucket,
                       'rent' as source, rp.platform_fee as amount
                  from rent_payments rp
                 where rp.status = 'paid'
                   and rp.paid_date >= cast(:from as date)
                   and rp.paid_date <  cast(:to   as date)
                union all
                select date_trunc(:interval, s.started_at at time zone '%1$s'),
                       'subscriptions', p.price
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
     * <p>{@code union}, not {@code union all}: somebody who paid rent and bought a boost in the same
     * month is one paying customer, and counting them twice would deflate ARPPU exactly where the
     * business is doing well.
     *
     * <p>The rent payer is the <em>tenant</em>, reached through the tenancy — {@code rent_payments}
     * records which tenancy settled, not which person, and the landlord on that row is being paid
     * rather than paying.
     */
    private static final String PAYING_USERS = """
            select count(*) from (
                select t.tenant_id as uid
                  from rent_payments rp
                  join tenancies t on t.id = rp.tenancy_id
                 where rp.status = 'paid'
                   and rp.paid_date >= cast(:from as date)
                   and rp.paid_date <  cast(:to   as date)
                union
                select s.user_id
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
     * <p><strong>Three sources, one settlement vocabulary.</strong> The underlying tables speak
     * three different status languages — {@code due/paid/overdue/failed},
     * {@code active/past-due/cancelled/expired} and {@code active/expired} — and none of them is
     * about settlement. A subscription that is {@code cancelled} was still paid for; a boost that is
     * {@code expired} was still bought. So the ledger derives the only status a finance reader is
     * asking about, which is whether the money arrived: {@code paid}, {@code pending} or
     * {@code failed}.
     *
     * <p><strong>{@code refunded} is deliberately not in that vocabulary.</strong> The platform has
     * no refund path, so a ledger that offered the value would be advertising a state no row can
     * ever hold — which is the disclosure {@code refundsMeasured} exists to make, and it must not be
     * contradicted two panels away.
     *
     * <p><strong>Amounts are the platform's share, never the gross.</strong> A rent payment
     * contributes its {@code platform_fee} and not the rent, for the reason
     * {@link #REVENUE_BY_SOURCE} gives: the rent is the landlord's money passing through. This is
     * the single most likely misreading of this table, which is why the column is labelled as the
     * platform's take on the screen as well.
     *
     * <p>Format argument: the row filter, so the page and its count cannot drift apart.
     */
    private static final String LEDGER_ROWS = """
            select rp.id as id,
                   coalesce(rp.paid_date, rp.due_date) as occurred_on,
                   coalesce(u.name, 'Tenant') as party,
                   'rent_fee' as kind,
                   rp.platform_fee as amount,
                   case rp.status
                     when 'paid'   then 'paid'
                     when 'failed' then 'failed'
                     else 'pending'
                   end as settlement,
                   rp.method as method
              from rent_payments rp
              left join tenancies t on t.id = rp.tenancy_id
              left join users u on u.id = t.tenant_id
            union all
            select s.id,
                   cast((s.started_at at time zone '%1$s') as date),
                   coalesce(u.name, 'Member'),
                   'subscription',
                   p.price,
                   case when s.payment_ref is not null and s.status <> 'pending'
                        then 'paid' else 'pending' end,
                   null
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
                   case when b.paid_at is not null then 'paid' else 'pending' end,
                   null
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
     * the mapping depend on the declaration order inside three separate {@code union all} branches.
     * Adding a column to one of them would then shift every index — and a {@code ClassCastException}
     * is the <em>lucky</em> outcome, because {@code party} and {@code kind} are both text and would
     * simply swap.
     */
    private static final String LEDGER_PROJECTION =
            "select id, occurred_on, party, kind, amount, settlement, method from ";

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
     * GST the platform collected in {@code [from, to)}.
     *
     * <p><strong>Rent only, and that is a measurement rather than an omission.</strong>
     * {@code rent_payments.gst} is the one place on the platform where tax is stored as its own
     * number. Subscription and boost prices are single figures with no tax component recorded
     * beside them, so any GST attributed to them would be this query multiplying by a rate it
     * invented. The screen says which sources the figure covers for the same reason.
     */
    public long gstCollected(LocalDate from, LocalDate to) {
        return ((Number) em.createNativeQuery("""
                select coalesce(sum(rp.gst), 0)
                  from rent_payments rp
                 where rp.status = 'paid'
                   and rp.paid_date >= cast(:from as date)
                   and rp.paid_date <  cast(:to   as date)
                """)
                .setParameter("from", from)
                .setParameter("to", to)
                .getSingleResult()).longValue();
    }

    /**
     * Platform fees on rent that has been billed and not settled.
     *
     * <p>The fee, not the rent: this is money owed to <em>the platform</em>, which is what an
     * outstanding figure on a finance console means. The gross unsettled rent is owed to landlords
     * and is a different line entirely — see {@link #payoutsDue()} for the settled half of it.
     */
    public long pendingSettlement() {
        return ((Number) em.createNativeQuery("""
                select coalesce(sum(rp.platform_fee), 0)
                  from rent_payments rp
                 where rp.status in ('due', 'overdue')
                """).getSingleResult()).longValue();
    }

    /**
     * One page of the settlement ledger, newest first.
     *
     * <p>Ordered by {@code occurred_on desc} with {@code id} breaking ties. The tiebreak is not
     * decoration: three unioned sources routinely produce several rows on one date, and without a
     * total order a row can appear on two consecutive pages while another appears on neither.
     *
     * @param kind {@code rent_fee}, {@code subscription}, {@code featured}, or null for all
     * @param settlement {@code paid}, {@code pending}, {@code failed}, or null for all
     * @param q a party-name substring, already wrapped in {@code %}, or null
     * @return rows of {@code [id, occurredOn, party, kind, amount, settlement, method]}
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
