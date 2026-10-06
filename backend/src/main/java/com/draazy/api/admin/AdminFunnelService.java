package com.draazy.api.admin;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.error.BadRequestException;
import jakarta.persistence.EntityManager;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Weekly counts behind {@code GET /admin/analytics/funnel}; see {@link AdminAnalyticsFunnel}. */
@Service
public class AdminFunnelService {

    static final int DEFAULT_DAYS = 90;
    static final int MAX_DAYS = 365;

    /** Column order of {@link AdminAnalyticsFunnel.Week} after {@code week}. */
    private static final List<String> STAGES = List.of("posted", "approved", "contacts", "visits", "deals");

    /* First approval audit row per listing, so a re-approval is not a second go-live; the join matches
       id or slug because routes record whichever key the caller used. */
    private static final String EVENTS = """
            with events(stage, at) as (
                select 'posted', p.created_at from properties p where p.archived = false
                union all
                select 'approved', min(a.at)
                  from properties p
                  join audit_log a
                    on a.entity = 'property'
                   and (a.entity_id = cast(p.id as text) or a.entity_id = p.slug)
                   and ((a.action = 'property.status' and a.metadata ->> 'to' = 'approved')
                     or (a.action = 'property.verification.decision' and a.metadata ->> 'decision' = 'approve'))
                 where p.archived = false
                 group by p.id
                union all
                select 'contacts', c.created_at from contact_requests c
                union all
                select 'visits', v.created_at from visits v
                union all
                select 'deals', d.closed_at from deals d where d.status = 'closed' and d.closed_at is not null
            )
            select stage, cast(date_trunc('week', at at time zone '%1$s') as date), count(*)
              from events
             where (at at time zone '%1$s') >= cast(:from as date)
               and (at at time zone '%1$s') <  cast(:to as date)
             group by 1, 2
            """.formatted(PlatformTime.IST.getId());

    private final EntityManager em;

    public AdminFunnelService(EntityManager em) {
        this.em = em;
    }

    @Transactional(readOnly = true)
    public AdminAnalyticsFunnel report(Integer requested) {
        int days = requested == null ? DEFAULT_DAYS : requested;
        if (days < 1 || days > MAX_DAYS) {
            throw new BadRequestException("days must be between 1 and " + MAX_DAYS + ", was " + days);
        }
        LocalDate to = LocalDate.now(PlatformTime.IST).plusDays(1);
        LocalDate from = to.minusDays(days);

        // Zero-filled so a quiet week is drawn as zero rather than skipped by the chart.
        Map<LocalDate, long[]> weekly = new TreeMap<>();
        for (LocalDate w = from.with(DayOfWeek.MONDAY); w.isBefore(to); w = w.plusWeeks(1)) {
            weekly.put(w, new long[STAGES.size()]);
        }

        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery(EVENTS)
                .setParameter("from", from)
                .setParameter("to", to)
                .getResultList();
        for (Object[] row : rows) {
            LocalDate week = row[1] instanceof java.sql.Date d ? d.toLocalDate() : (LocalDate) row[1];
            weekly.get(week)[STAGES.indexOf((String) row[0])] = ((Number) row[2]).longValue();
        }

        List<AdminAnalyticsFunnel.Week> weeks = new ArrayList<>();
        weekly.forEach((w, c) -> weeks.add(new AdminAnalyticsFunnel.Week(w, c[0], c[1], c[2], c[3], c[4])));
        return new AdminAnalyticsFunnel(days, from, to, weeks);
    }
}
