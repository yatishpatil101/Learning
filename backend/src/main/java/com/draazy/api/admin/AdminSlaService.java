package com.draazy.api.admin;

import com.draazy.api.common.error.BadRequestException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Turnaround runs from the earliest audit_log row; the latest would time re-checks, not the decision. */
@Service
public class AdminSlaService {

    /** 24h keeps the bar fixed, so compliance changes reflect real turnaround, not a moved target. */
    private static final int TARGET_HOURS = 24;

    /** Enough to open and act on. A queue view is {@code /admin/properties?status=pending}. */
    private static final int WORST_PENDING_LIMIT = 10;

    /** Assign an incoming service request within four hours. See the class docblock on targets. */
    private static final int PICKUP_TARGET_HOURS = 4;

    /** Finish it within three days. */
    private static final int DELIVERY_TARGET_HOURS = 72;

    /** A staff-posted listing goes live within a week. */
    private static final int CONCIERGE_TARGET_HOURS = 168;

    /** Guard rail on {@code ?days=}, matching {@code AdminSupplyGapService}. */
    private static final int MAX_WINDOW_DAYS = 365;

    /** Casts the uuid down to text because audit {@code entity_id} may hold a slug (casting it up would raise); the window is a
     * {@code having} on {@code min(a.at)} so a later re-check is never promoted to the first decision. */
    private static final String SUMMARY = """
            with reviewed as (
                select cast(extract(epoch from (min(a.at) - p.created_at)) / 3600.0
                            as double precision) as hours
                  from properties p
                  join audit_log a
                    on a.entity = 'property'
                   and a.action = 'property.status'
                   and (a.entity_id = cast(p.id as text) or a.entity_id = p.slug)
                 where p.archived = false
                 group by p.id, p.created_at
                having (cast(:since as timestamptz) is null
                        or min(a.at) >= cast(:since as timestamptz))
            ),
            pending as (
                select cast(extract(epoch from (now() - coalesce(p.resubmitted_at, p.created_at)))
                            / 3600.0 as double precision) as hours
                  from properties p
                 where p.archived = false
                   and p.status = 'pending'
            )
            select (select count(*) from reviewed),
                   (select avg(hours) from reviewed),
                   (select percentile_cont(0.5) within group (order by hours) from reviewed),
                   (select count(*) from reviewed where hours > :target),
                   (select count(*) from pending),
                   (select count(*) from pending where hours > :target)
            """;

    /** Unwindowed like {@code pendingCount}: the oldest rows are exactly what a {@code ?days=} filter would remove first. */
    private static final String WORST_PENDING = """
            select cast(p.id as text),
                   p.title,
                   cast(extract(epoch from (now() - coalesce(p.resubmitted_at, p.created_at)))
                        / 3600.0 as double precision) as hours
              from properties p
             where p.archived = false
               and p.status = 'pending'
             order by coalesce(p.resubmitted_at, p.created_at) asc
             limit :limit
            """;

    /** The six figures of one track over a completed and an outstanding set, under the review summary's window, cast and no-{@code coalesce} rules
     * (an empty set stays null, not a perfect score); a format template so the window predicate is fixed in one place. */
    private static final String TRACK = """
            with completed as (
                %s
            ),
            outstanding as (
                %s
            )
            select (select count(*) from completed),
                   (select avg(hours) from completed),
                   (select percentile_cont(0.5) within group (order by hours) from completed),
                   (select count(*) from completed where hours > :target),
                   (select count(*) from outstanding),
                   (select count(*) from outstanding where hours > :target)
            """;

    /** Raised to a service desk and not yet finished — the two states of an open ticket. */
    private static final String TICKET_UNRESOLVED = "('open', 'in-progress', 'waiting')";

    /** {@code <> 'none'} is {@code TicketUpdate.UNASSIGN}: handing a ticket back writes a non-null {@code assigneeId} too, which must not count as a pickup. */
    private static final String PICKUP_COMPLETED = """
            select cast(extract(epoch from (min(a.at) - t.created_at)) / 3600.0
                        as double precision) as hours
              from tickets t
              join audit_log a
                on a.entity = 'ticket'
               and a.action = 'ticket.update'
               and a.entity_id = cast(t.id as text)
               and a.metadata ->> 'assigneeId' is not null
               and a.metadata ->> 'assigneeId' <> 'none'
             group by t.id, t.created_at
            having (cast(:since as timestamptz) is null
                    or min(a.at) >= cast(:since as timestamptz))
            """;

    /** Open work nobody owns. A ticket that was picked up and finished is not waiting for pickup. */
    private static final String PICKUP_OUTSTANDING = """
            select cast(extract(epoch from (now() - t.created_at)) / 3600.0
                        as double precision) as hours
              from tickets t
             where t.assignee_id is null
               and t.status in """ + TICKET_UNRESOLVED;

    /** {@code closed} counts too: a desk that closes without resolving would leave tickets outstanding forever. */
    private static final String DELIVERY_COMPLETED = """
            select cast(extract(epoch from (min(a.at) - t.created_at)) / 3600.0
                        as double precision) as hours
              from tickets t
              join audit_log a
                on a.entity = 'ticket'
               and a.action = 'ticket.update'
               and a.entity_id = cast(t.id as text)
               and a.metadata ->> 'toStatus' in ('resolved', 'closed')
             group by t.id, t.created_at
            having (cast(:since as timestamptz) is null
                    or min(a.at) >= cast(:since as timestamptz))
            """;

    private static final String DELIVERY_OUTSTANDING = """
            select cast(extract(epoch from (now() - t.created_at)) / 3600.0
                        as double precision) as hours
              from tickets t
             where t.status in """ + TICKET_UNRESOLVED;

    /** Only {@code 'approved'} puts it live; the first decision may be a bounce, not go-live. */
    private static final String CONCIERGE_COMPLETED = """
            select cast(extract(epoch from (min(a.at) - p.created_at)) / 3600.0
                        as double precision) as hours
              from properties p
              join audit_log a
                on a.entity = 'property'
               and a.action = 'property.status'
               and (a.entity_id = cast(p.id as text) or a.entity_id = p.slug)
               and a.metadata ->> 'to' = 'approved'
             where p.posted_by_admin = true
               and p.archived = false
             group by p.id, p.created_at
            having (cast(:since as timestamptz) is null
                    or min(a.at) >= cast(:since as timestamptz))
            """;

    /** {@code pending} only: a rejected listing is finished; counting it would punish correct turn-downs. */
    private static final String CONCIERGE_OUTSTANDING = """
            select cast(extract(epoch from (now() - p.created_at)) / 3600.0
                        as double precision) as hours
              from properties p
             where p.posted_by_admin = true
               and p.archived = false
               and p.status = 'pending'
            """;

    private final EntityManager em;

    public AdminSlaService(EntityManager em) {
        this.em = em;
    }

    @Transactional(readOnly = true)
    public SlaSummary report(Integer days) {
        // All time by default: a review record is history, and a 30-day default would answer a different question.
        if (days != null && (days < 1 || days > MAX_WINDOW_DAYS)) {
            throw new BadRequestException("days must be between 1 and " + MAX_WINDOW_DAYS);
        }
        Instant since = days == null ? null : Instant.now().minus(days, ChronoUnit.DAYS);

        Object[] row = (Object[]) em.createNativeQuery(SUMMARY)
                .setParameter("since", since)
                .setParameter("target", (double) TARGET_HOURS)
                .getSingleResult();

        long reviewed = num(row[0]);
        Double avg = hours(row[1]);
        Double median = hours(row[2]);
        long breached = num(row[3]);

        // Null, not 100. A team that has decided nothing has not met the SLA perfectly; it has no
        // record at all, and the only figure that says so is the absence of one.
        Integer slaRate = complianceRate(reviewed, breached);

        return new SlaSummary(TARGET_HOURS, reviewed, avg, median, breached, slaRate,
                num(row[4]), num(row[5]), worstPending(),
                track(PICKUP_COMPLETED, PICKUP_OUTSTANDING, PICKUP_TARGET_HOURS, since),
                track(DELIVERY_COMPLETED, DELIVERY_OUTSTANDING, DELIVERY_TARGET_HOURS, since),
                track(CONCIERGE_COMPLETED, CONCIERGE_OUTSTANDING, CONCIERGE_TARGET_HOURS, since));
    }

    /** Four statements, not one: a single query would repeat the {@code :target} comparison under four aliases. */
    private SlaSummary.Track track(String completed, String outstanding, int targetHours, Instant since) {
        Object[] row = (Object[]) em.createNativeQuery(TRACK.formatted(completed, outstanding))
                .setParameter("since", since)
                .setParameter("target", (double) targetHours)
                .getSingleResult();

        long done = num(row[0]);
        long breached = num(row[3]);
        Integer rate = complianceRate(done, breached);

        return new SlaSummary.Track(targetHours, done, hours(row[1]), hours(row[2]), breached, rate,
                num(row[4]), num(row[5]));
    }

    /** Null, not 100: a desk that closed nothing has no compliance record, and 100 would read as doing well. */
    private static Integer complianceRate(long completed, long breached) {
        return completed == 0
                ? null
                : (int) Math.round((completed - breached) * 100.0 / completed);
    }

    @SuppressWarnings("unchecked")
    private List<SlaSummary.PendingListing> worstPending() {
        Query query = em.createNativeQuery(WORST_PENDING).setParameter("limit", WORST_PENDING_LIMIT);
        List<Object[]> rows = query.getResultList();
        List<SlaSummary.PendingListing> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            out.add(new SlaSummary.PendingListing(
                    (String) r[0], (String) r[1], round1(((Number) r[2]).doubleValue())));
        }
        return out;
    }

    private static long num(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }

    /** Null in, null out — the one conversion in this class that must not produce a zero. */
    private static Double hours(Object value) {
        return value == null ? null : round1(((Number) value).doubleValue());
    }

    /** Presentation only; SQL compares exact values, so a 24.04h listing is still counted as a breach. */
    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }
}
