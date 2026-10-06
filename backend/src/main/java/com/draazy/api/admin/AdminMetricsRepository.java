package com.draazy.api.admin;

import com.draazy.api.common.PlatformTime;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

@Repository
public class AdminMetricsRepository {

    // Spelled as a string because it is interpolated into SQL.
    private static final String IST = PlatformTime.IST.getId();

    // A row later `cancelled` because it was superseded by an upgrade still counts, correctly: it was paid for.
    // Each source is counted only where there is an unambiguous marker that money arrived.
    private static final String REVENUE_BY_SOURCE = """
            select 'subscriptions' as source, coalesce(sum(s.amount), 0) as amount
              from subscriptions s
                 where s.payment_ref is not null
                   and s.status <> 'pending'
               and (cast(:from as date) is null
                    or (s.started_at at time zone '%1$s') >= cast(:from as date))
               and (cast(:to   as date) is null
                    or (s.started_at at time zone '%1$s') <  cast(:to   as date))
            """.formatted(IST);

    // A source column would change this operation for every caller to serve one screen.
    // Buckets with no money in a given source simply do not appear; the service fills the gaps.
    private static final String REVENUE_SERIES_BY_SOURCE = """
            select bucket, source, sum(amount) as amount from (
                select date_trunc(:interval, s.started_at at time zone '%1$s') as bucket,
                       'subscriptions' as source, s.amount as amount
                  from subscriptions s
                 where s.payment_ref is not null
                   and s.status <> 'pending'
                   and (s.started_at at time zone '%1$s') >= cast(:from as date)
                   and (s.started_at at time zone '%1$s') <  cast(:to   as date)
            ) parts
            group by bucket, source
            order by bucket, source
            """.formatted(IST);

    private static final String MRR = """
            select coalesce(sum(
                     case coalesce(p.billing_cycle, 'monthly')
                       when 'monthly'   then s.amount
                       when 'quarterly' then round(s.amount / 3.0)
                       when 'yearly'    then round(s.amount / 12.0)
                       else s.amount
                     end), 0)::bigint
              from subscriptions s
              join plans p on p.id = s.plan_id
             where s.status = 'active'
               and s.payment_ref is not null
               and s.amount > 0
            """;

    // Group by charged amount so repriced plans show old and new cohorts separately.
    private static final String PLAN_LINES = """
            select p.name, p.audience, coalesce(p.billing_cycle, 'monthly'), s.amount,
                   count(*) as active,
                   coalesce(sum(
                     case coalesce(p.billing_cycle, 'monthly')
                       when 'monthly'   then s.amount
                       when 'quarterly' then round(s.amount / 3.0)
                       when 'yearly'    then round(s.amount / 12.0)
                       else s.amount
                     end), 0)::bigint as monthly
              from subscriptions s
              join plans p on p.id = s.plan_id
             where s.status = 'active'
               and s.payment_ref is not null
               and s.amount > 0
             group by p.id, p.name, p.audience, p.billing_cycle, s.amount
             order by p.name, s.amount
            """;

    // The denominator of ARPPU, and deliberately a different question from `countUsers` — which is the denominator of ARPU.
    // Both totals are exposed because one cannot safely stand in for the other.
    private static final String PAYING_USERS = """
            select count(distinct s.user_id)
              from subscriptions s
                 where s.payment_ref is not null
                   and s.status <> 'pending'
               and s.amount > 0
                   and (s.started_at at time zone '%1$s') >= cast(:from as date)
                   and (s.started_at at time zone '%1$s') <  cast(:to   as date)
            """.formatted(IST);

    // `refunded` is deliberately not in that vocabulary.
    private static final String LEDGER_ROWS = """
            select s.id as id,
                   cast((s.started_at at time zone '%1$s') as date) as occurred_on,
                   coalesce(u.name, 'Member') as party,
                   'subscription' as kind,
                   s.amount as amount,
                   case when s.payment_ref is not null and s.status <> 'pending'
                        then 'paid' else 'pending' end as settlement
              from subscriptions s
              left join users u on u.id = s.user_id
             where s.amount > 0
            """.formatted(IST);

    // The filter applied to `#LEDGER_ROWS`, written once and used by both the page and its count.
    // Every bound parameter is `cast(… as text)` before the null test.
    private static final String LEDGER_FILTER = """
             where (cast(:kind       as text) is null or kind       = cast(:kind       as text))
               and (cast(:settlement as text) is null or settlement = cast(:settlement as text))
               and (cast(:q          as text) is null or party ilike cast(:q as text) escape '\\')
            """;

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

    public long countContactRequests(String status) {
        return count("select count(*) from contact_requests where status = :v", status);
    }

    public long countVisits(String status) {
        return count("select count(*) from visits where status = :v", status);
    }

    public long countDealsNotClosed() {
        return count("select count(*) from deals where status <> :v", "closed");
    }

    public long countUsersWithRole(String role) {
        return count("select count(*) from users where archived = false and role = :v", role);
    }

    private long count(String sql, String value) {
        return ((Number) em.createNativeQuery(sql).setParameter("v", value)
                .getSingleResult()).longValue();
    }

    // SQL fragments come only from AdminMetricsService's fixed metric map, not requests.
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

    @SuppressWarnings("unchecked")
    public List<Object[]> subscriptionPlanLines() {
        return em.createNativeQuery(PLAN_LINES).getResultList();
    }

    public long payingUsers(LocalDate from, LocalDate to) {
        return ((Number) em.createNativeQuery(PAYING_USERS)
                .setParameter("from", from)
                .setParameter("to", to)
                .getSingleResult()).longValue();
    }

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

    public long ledgerCount(String kind, String settlement, String q) {
        return ((Number) em.createNativeQuery(
                "select count(*) from (" + LEDGER_ROWS + ") ledger" + LEDGER_FILTER)
                .setParameter("kind", kind)
                .setParameter("settlement", settlement)
                .setParameter("q", q)
                .getSingleResult()).longValue();
    }
    }
