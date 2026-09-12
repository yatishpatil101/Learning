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

/**
 * Moderation turnaround, measured from what actually happened.
 *
 * <p><strong>What this replaces.</strong> The SLA tab computed every turnaround as
 * {@code 2 + rng(314159)() * 30}. The "average approval time" an operator read was therefore a
 * seeded constant: it did not move when the team got faster, it did not move when the team got
 * slower, and it did not move when the queue was abandoned for a fortnight. A metric that cannot
 * respond to the thing it measures is worse than no metric, because it is trusted.
 *
 * <p><strong>Where the real timestamps live, and why no column was added.</strong> There is no
 * {@code properties.reviewed_at} and this deliberately does not introduce one. A new column would
 * be null for every listing already decided, so the report would be blind to the platform's whole
 * history until enough new decisions accumulated to make it look populated — the worst failure mode
 * available, since a partially-backfilled average is indistinguishable from a real one.
 * {@code audit_log} already holds the answer: {@code PropertyModerationService.setStatus} writes a
 * {@code property.status} row on <em>every</em> transition, with the actor and the instant, and it
 * has done so since the moderation route existed.
 *
 * <p><strong>Earliest audit row, not latest.</strong> Turnaround is {@code created_at} to the
 * <em>first</em> {@code property.status} row for that listing. A listing can be decided more than
 * once — an approved listing that is re-approved after a stays-live re-check, or one bounced back to
 * pending and approved again — and each of those writes another row. Taking the latest would time
 * the most recent glance rather than the first decision, and since a re-check happens long after
 * the original approval, it would report a queue that is getting slower every time somebody
 * double-checks their own work. Averaging all of them in would do the same thing more quietly.
 *
 * <p><strong>Three more tracks, on the same evidence (D252).</strong> Ticket pickup, ticket delivery
 * and the concierge pipeline used to be the other three quarters of this tab, and all three were
 * {@code rng(314159)} — a seeded constant wearing an hours label. Each one now measures the same way
 * the review track does, out of {@code audit_log}: {@code TicketService.update} writes a
 * {@code ticket.update} row carrying {@code toStatus} and {@code assigneeId} on every change, and
 * {@code PropertyModerationService.setStatus} writes {@code property.status} carrying {@code to}.
 *
 * <p>The metadata predicates are what make each one a different question of the same table, and
 * they are worth stating because none is interchangeable with the others:
 *
 * <ul>
 *   <li><em>Pickup</em> is the first row where {@code assigneeId} is a real id. It cannot be read
 *       off {@code tickets.assignee_id}, which holds the <em>current</em> owner: a ticket assigned
 *       within the hour, handed on twice and finally unassigned has a pickup time, and the column
 *       says {@code null}. {@link com.draazy.api.services.ticket.TicketUpdate#UNASSIGN} is the
 *       reserved word {@code none}, so it is excluded explicitly — an unassignment is a row with a
 *       non-null {@code assigneeId} in the metadata, and counting it as a pickup would time the
 *       moment a ticket was <em>abandoned</em>.</li>
 *   <li><em>Delivery</em> is the first row reaching {@code resolved} or {@code closed}. Both,
 *       because a desk that closes a ticket without resolving it has still finished with it, and
 *       counting only {@code resolved} would leave those tickets outstanding forever.</li>
 *   <li><em>Concierge</em> is the first {@code property.status} row whose {@code to} is
 *       {@code approved} — not simply the first decision, which is what the review track measures.
 *       A staff-posted listing bounced back to pending and approved a week later went live once,
 *       and it went live on the second row.</li>
 * </ul>
 *
 * <p><strong>Targets are the mock's own numbers.</strong> 4h, 72h and 168h are exactly what
 * {@code lib/data/analytics/sla.js} declared, kept for the same reason {@link #TARGET_HOURS} keeps
 * 24: moving the bar in the change that makes the measurement real would leave nobody able to say
 * whether compliance moved because the team did or because the target did.
 */
@Service
public class AdminSlaService {

    /**
     * The review SLA: a listing gets a decision within a day.
     *
     * <p>24 because that is what the tab this replaces used, and changing the target in the same
     * change that made the measurement real would have made the before/after incomparable — a
     * reviewer could not tell whether the compliance figure moved because the numbers became true or
     * because the bar moved. Served on the response rather than left in the browser; see
     * {@link SlaSummary#targetHours()}.
     */
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

    /**
     * Every figure on the report, in one statement.
     *
     * <p><strong>Why the join is on text and not uuid.</strong> {@code audit_log.entity_id} is
     * {@code text} because the table is generic over every entity on the platform, and the row is
     * written from the moderation route's path variable — which the admin UI populates with the
     * listing's <em>slug</em>, because a listing's public URL key is its slug rather than its uuid
     * ({@code PropertyModerationService.load} resolves either). So the predicate matches both
     * spellings. It casts the uuid down to text rather than casting {@code entity_id} up to uuid,
     * and that direction is load-bearing: {@code cast('some-slug' as uuid)} raises, which would take
     * down the whole report the first time somebody moderated from the screen instead of by id. It
     * is also the direction that can use {@code idx_audit_log_entity}, which is on
     * {@code (entity, entity_id)}.
     *
     * <p><strong>One statement, not one per listing.</strong> The obvious shape — load the reviewed
     * properties, then ask for each one's first audit row — is a query per listing, and this is a
     * report over the whole table with no page size. The {@code group by} does the same work in a
     * single index scan.
     *
     * <p><strong>{@code having}, not {@code where}, for the window.</strong> {@code ?days=} filters
     * on when the decision was taken, and the decision instant is {@code min(a.at)} — an aggregate,
     * which does not exist yet in {@code where}. Filtering the audit rows in {@code where} instead
     * would silently change the definition: a listing decided long ago and re-checked yesterday
     * would have its re-check promoted to "first decision" and enter the window with a turnaround
     * measured to the wrong row. The window selects whole listings by their real decision, or not at
     * all.
     *
     * <p><strong>Cast to {@code double precision} in the CTE.</strong> {@code extract(epoch …)}
     * yields {@code numeric}, and {@code percentile_cont} accepts only {@code double precision} or
     * {@code interval}. Casting once where the value is defined keeps the two aggregates below
     * reading the same column rather than one of them carrying a repair.
     *
     * <p><strong>{@code avg} over no rows is null, and that is kept.</strong> No {@code coalesce}
     * here or anywhere above it: see {@link SlaSummary}.
     */
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
                   and p.status in ('approved', 'rejected')
                 group by p.id, p.created_at
                having (cast(:since as timestamptz) is null
                        or min(a.at) >= cast(:since as timestamptz))
            ),
            pending as (
                select cast(extract(epoch from (now() - p.created_at)) / 3600.0
                            as double precision) as hours
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

    /**
     * The oldest listings still awaiting a decision.
     *
     * <p>Unwindowed for the same reason {@code pendingCount} is: the rows worth showing are exactly
     * the ones a {@code ?days=} filter would remove first.
     */
    private static final String WORST_PENDING = """
            select cast(p.id as text),
                   p.title,
                   cast(extract(epoch from (now() - p.created_at)) / 3600.0
                        as double precision) as hours
              from properties p
             where p.archived = false
               and p.status = 'pending'
             order by p.created_at asc
             limit :limit
            """;

    /**
     * The six figures of one track, over a completed set and an outstanding set it is handed.
     *
     * <p>The same six aggregates the review summary ends with, over the same two shapes — a
     * {@code completed} relation of turnarounds in hours, and an {@code outstanding} relation of
     * ages in hours. Every decision the summary's docblock argues for applies unchanged here:
     * {@code having} rather than {@code where} for the window (the decision instant is an
     * aggregate), the cast to {@code double precision} for {@code percentile_cont}, and no
     * {@code coalesce} anywhere, so an empty set stays null instead of becoming a perfect score.
     *
     * <p>A format template rather than three near-identical strings, because the only thing that
     * differs between the tracks is which rows count as done and which count as waiting. Written
     * out three times, the next person to fix the window predicate would have fixed it in one.
     */
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

    /**
     * Creation to the first audit row that named a real assignee.
     *
     * <p>{@code <> 'none'} is {@code TicketUpdate.UNASSIGN}: handing a ticket back to the pool
     * writes a non-null {@code assigneeId} too, and reading it as a pickup would time the moment
     * the ticket was let go of.
     */
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

    /**
     * Creation to the first audit row reaching a terminal status.
     *
     * <p>{@code closed} counts as well as {@code resolved}: a desk that closes a request without
     * resolving it has still finished with it, and a track that recognised only {@code resolved}
     * would leave every such ticket outstanding for ever and drag the backlog age up with it.
     */
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

    /**
     * A staff-posted listing's creation to the first row that put it live.
     *
     * <p>{@code metadata ->> 'to' = 'approved'} rather than simply the first decision, which is what
     * the review track measures. A concierge listing bounced back for a missing document and
     * approved a week later went live once, and it went live on the second row — the first is when
     * somebody looked at it, which this track is not asking about.
     */
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

    /**
     * Concierge listings still short of live.
     *
     * <p>{@code pending} only, not "anything that is not approved". A rejected staff-posted listing
     * is finished with — it is not going live, and leaving it here would grow the backlog every time
     * the pipeline correctly turned something down, which is the one figure that must not punish
     * the desk for doing its job.
     */
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

    /**
     * @param days optional window on the <em>decision</em> instant; null means all time
     * @return the SLA scorecard, with nulls where nothing has been reviewed
     */
    @Transactional(readOnly = true)
    public SlaSummary report(Integer days) {
        // All time by default, unlike /admin/supply-gap's 30 days. Demand is a flow and only means
        // anything over a window; a review record is a history, and defaulting to a month would
        // quietly answer a different question than the tab this replaces — which measured every
        // listing it had — while looking like the same number.
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

    /**
     * One track, from the two relations that define it.
     *
     * <p>Four statements where the review summary needs one, and deliberately so: the four tracks
     * are over three different tables with three different targets, and folding them into a single
     * query would mean four copies of the {@code :target} comparison under four aliases in one
     * six-hundred-character select list. They are aggregate reads on indexed columns behind a
     * staff-only route, so the cost is four cheap round trips on a tab nobody opens in a loop.
     */
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

    /**
     * The share of finished work that finished inside its target, or null when nothing has finished.
     *
     * <p>Null, not 100. A desk that has closed nothing has not met its SLA perfectly — it has no
     * compliance record at all, and the only figure that says so is the absence of one. Both
     * callers are places where a hundred would be read as a team doing well.
     */
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

    /**
     * One decimal place, matching what the tab already displayed.
     *
     * <p>Presentation only. Every comparison against the target is made in SQL on the exact value,
     * so a listing that took 24.04 hours is counted as a breach even though it prints as 24.0 —
     * rounding the number the decision is made on would move the SLA boundary by three minutes in
     * the platform's own favour.
     */
    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }
}
