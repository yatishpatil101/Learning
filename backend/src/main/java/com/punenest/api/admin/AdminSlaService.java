package com.punenest.api.admin;

import com.punenest.api.common.error.BadRequestException;
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
        Integer slaRate = reviewed == 0
                ? null
                : (int) Math.round((reviewed - breached) * 100.0 / reviewed);

        return new SlaSummary(TARGET_HOURS, reviewed, avg, median, breached, slaRate,
                num(row[4]), num(row[5]), worstPending());
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
