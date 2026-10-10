package com.draazy.api.admin.staff;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Repository;

@Repository
class TeamPerformanceRepository {

    private static final String STAFF = """
            select u.id::text, coalesce(nullif(u.name, ''), u.mobile, u.id::text)
            from users u
            where u.role = 'staff' and u.archived = false
            """;

    private static final String ACTIVITY = """
            select a.actor, a.action, a.entity, sr.team, count(*)
            from audit_log a
            left join service_requests sr
              on a.entity = 'service_request' and a.entity_id = sr.id::text
            where a.actor_role = 'staff'
              and a.at >= cast(:from as timestamptz)
              and a.at < cast(:to as timestamptz)
            group by a.actor, a.action, a.entity, sr.team
            """;

    private static final String ACTIVITY_BY_ACTOR = """
            select a.actor, a.action, a.entity, sr.team, count(*)
            from audit_log a
            left join service_requests sr
              on a.entity = 'service_request' and a.entity_id = sr.id::text
            where a.actor = :actor
              and a.at >= cast(:from as timestamptz)
              and a.at < cast(:to as timestamptz)
            group by a.actor, a.action, a.entity, sr.team
            """;

    private static final String QUEUES = """
            select 'kyc', count(*) filter (where status = 'pending'),
                   min(submitted_at) filter (where status = 'pending'),
                   percentile_cont(0.5) within group
                     (order by extract(epoch from (decided_at - submitted_at)) / 60.0)
                     filter (where decided_at >= cast(:from as timestamptz)
                             and status in ('verified', 'rejected', 'revoked')
                             and submitted_at is not null and decided_at is not null)
            from identity_verifications
            union all
            select 'propertyVerification', count(*), min(waiting_since),
                   (select percentile_cont(0.5) within group
                      (order by extract(epoch from (decided_at - created_at)) / 60.0)
                    from property_reviews
                    where decided_at >= cast(:from as timestamptz)
                      and decided_at is not null)
            from (
              select created_at as waiting_since
              from property_reviews
              where status = 'pending'
              union all
              select ownership_requested_at
              from properties
              where not archived
                and ownership_requested_at is not null
                and ownership_verified = false
                and ownership_declined_at is null
            ) property_queue
            union all
            select 'listingModeration',
                   count(*) filter (where not archived and status = 'pending'),
                   min(coalesce(resubmitted_at, created_at)) filter (where not archived and status = 'pending'),
                   null::double precision
            from properties
            union all
            select 'support',
                   count(*) filter (where staff_unread and status not in ('resolved', 'closed')),
                   min(created_at) filter (where staff_unread and status not in ('resolved', 'closed')),
                   null::double precision
            from support_tickets
            union all
            select 'reports',
                   count(*) filter (where status in ('open', 'reviewing')),
                   min(created_at) filter (where status in ('open', 'reviewing')),
                   null::double precision
            from reports
            union all
            select 'desk:' || d.team,
                   count(q.waiting_since),
                   min(q.waiting_since),
                   null::double precision
            from (values ('rental'), ('legal'), ('loans'), ('interior'), ('packers'), ('valuation')) d(team)
            left join (
              select team, created_at as waiting_since
              from service_requests
              where status not in ('awaiting-payment', 'draft-shared', 'completed', 'cancelled')
              union all
              select team, created_at as waiting_since
              from tickets
              where status in ('open', 'in-progress', 'waiting')
            ) q on q.team = d.team
            group by d.team
            """;

    private static final String PROPERTY_QUEUE = """
            select 'propertyVerification', count(*), min(waiting_since)
            from (
              select created_at as waiting_since
              from property_reviews
              where status = 'pending'
              union all
              select ownership_requested_at
              from properties
              where not archived
                and ownership_requested_at is not null
                and ownership_verified = false
                and ownership_declined_at is null
            ) property_queue
            """;

    // One branch per function a staffer holds, so /my-work never scans a desk it cannot work.
    private static final List<Map.Entry<String, String>> MY_QUEUES = List.of(
            Map.entry("kyc", """
                    select 'kyc', count(*) filter (where status = 'pending'),
                           min(submitted_at) filter (where status = 'pending')
                    from identity_verifications
                    """),
            Map.entry("propertyVerification", PROPERTY_QUEUE),
            Map.entry("listingModeration", """
                    select 'listingModeration',
                           count(*) filter (where not archived and status = 'pending'),
                           min(coalesce(resubmitted_at, created_at)) filter (where not archived and status = 'pending')
                    from properties
                    """),
            Map.entry("support", """
                    select 'support',
                           count(*) filter (where staff_unread and status not in ('resolved', 'closed')),
                           min(created_at) filter (where staff_unread and status not in ('resolved', 'closed'))
                    from support_tickets
                    """),
            Map.entry("reports", """
                    select 'reports',
                           count(*) filter (where status in ('open', 'reviewing')),
                           min(created_at) filter (where status in ('open', 'reviewing'))
                    from reports
                    """),
            Map.entry("reviews", """
                    select 'reviews',
                           count(*) filter (where status = 'pending'),
                           min(created_at) filter (where status = 'pending')
                    from reviews
                    """),
            Map.entry("enquiries", """
                    select 'enquiries',
                           count(*) filter (where status = 'pending'),
                           min(created_at) filter (where status = 'pending')
                    from contact_requests
                    """),
            Map.entry("societies", """
                    select 'societies', count(*), min(created_at)
                    from societies
                    where source = 'community' and merged_into is null and archived_at is null
                    """),
            Map.entry("referrals", """
                    select 'referrals',
                           count(*) filter (where status in ('pending', 'qualified')),
                           min("at") filter (where status in ('pending', 'qualified'))
                    from referrals
                    """));

    private static final List<String> DESK_TEAMS =
            List.of("rental", "legal", "loans", "interior", "packers", "valuation");

    private static final String MY_DESKS = """
            select 'desk:' || d.team, count(q.waiting_since), min(q.waiting_since)
            from (values %s) d(team)
            left join (
              select team, created_at as waiting_since
              from service_requests
              where status not in ('awaiting-payment', 'draft-shared', 'completed', 'cancelled')
              union all
              select team, created_at as waiting_since
              from tickets
              where status in ('open', 'in-progress', 'waiting')
            ) q on q.team = d.team
            group by d.team
            """;

    private final EntityManager em;

    TeamPerformanceRepository(EntityManager em) {
        this.em = em;
    }

    List<StaffAccount> staff() {
        List<StaffAccount> out = new ArrayList<>();
        for (Object row : em.createNativeQuery(STAFF).getResultList()) {
            Object[] cells = (Object[]) row;
            out.add(new StaffAccount(UUID.fromString(text(cells[0])), text(cells[1])));
        }
        return out;
    }

    String name(UUID id) {
        List<?> rows = em.createNativeQuery("""
                select coalesce(nullif(name, ''), mobile, id::text)
                from users
                where id = cast(:id as uuid)
                """)
                .setParameter("id", id.toString())
                .getResultList();
        return rows.isEmpty() ? id.toString() : text(rows.getFirst());
    }

    List<ActivityCount> activity(Instant from, Instant to) {
        Query query = em.createNativeQuery(ACTIVITY)
                .setParameter("from", from.toString())
                .setParameter("to", to.toString());
        return activity(query);
    }

    List<ActivityCount> activityForActor(UUID actor, Instant from, Instant to) {
        Query query = em.createNativeQuery(ACTIVITY_BY_ACTOR)
                .setParameter("actor", actor.toString())
                .setParameter("from", from.toString())
                .setParameter("to", to.toString());
        return activity(query);
    }

    private List<ActivityCount> activity(Query query) {
        List<ActivityCount> out = new ArrayList<>();
        for (Object row : query.getResultList()) {
            Object[] cells = (Object[]) row;
            out.add(new ActivityCount(
                    text(cells[0]),
                    text(cells[1]),
                    text(cells[2]),
                    text(cells[3]),
                    ((Number) cells[4]).longValue()));
        }
        return out;
    }

    List<MyWorkResponse.Queue> myQueues(Set<String> functions) {
        List<String> branches = new ArrayList<>();
        for (Map.Entry<String, String> queue : MY_QUEUES) {
            if (functions.contains(queue.getKey())) {
                branches.add(queue.getValue());
            }
        }
        // Team names come from DESK_TEAMS, never from the caller, so formatting them in is safe.
        String teams = DESK_TEAMS.stream()
                .filter(team -> functions.contains("desk:" + team))
                .map(team -> "('" + team + "')")
                .collect(Collectors.joining(", "));
        if (!teams.isEmpty()) {
            branches.add(MY_DESKS.formatted(teams));
        }
        if (branches.isEmpty()) {
            return List.of();
        }
        List<MyWorkResponse.Queue> out = new ArrayList<>();
        for (Object row : em.createNativeQuery(String.join(" union all ", branches)).getResultList()) {
            Object[] cells = (Object[]) row;
            out.add(new MyWorkResponse.Queue(text(cells[0]), ((Number) cells[1]).longValue(), toInstant(cells[2])));
        }
        return out;
    }

    List<TeamPerformanceResponse.QueueMetric> queues(Instant from) {
        Query query = em.createNativeQuery(QUEUES).setParameter("from", from.toString());
        List<TeamPerformanceResponse.QueueMetric> out = new ArrayList<>();
        for (Object row : query.getResultList()) {
            Object[] cells = (Object[]) row;
            out.add(new TeamPerformanceResponse.QueueMetric(
                    text(cells[0]),
                    ((Number) cells[1]).longValue(),
                    toInstant(cells[2]),
                    cells[3] == null ? null : ((Number) cells[3]).doubleValue()));
        }
        return out;
    }

    record StaffAccount(UUID id, String name) {
    }

    record ActivityCount(String actor, String action, String entity, String serviceTeam, long count) {
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }

    private static Instant toInstant(Object value) {
        if (value instanceof Instant instant) {
            return instant;
        }
        if (value instanceof OffsetDateTime offset) {
            return offset.toInstant();
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant();
        }
        return null;
    }
}
