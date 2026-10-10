package com.draazy.api.admin.staff;

import com.draazy.api.common.audit.AuditMetadata;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Repository;

/** Native SQL: {@code admin} may not import the modules it counts. Joins {@code u.id::text = a.actor}:
 * actor is free text, so a uuid cast would fail the whole query on one malformed row. */
@Repository
class StaffActivityRepository {

    /** Consumers write audit rows too (contact reveals), so scope to back-office roles in SQL, not a filter. */
    private static final String BACK_OFFICE = "a.actor_role in ('staff', 'manager', 'admin')";

    private static final String FILTERS = """
              and (cast(:actor  as text) is null or a.actor  = cast(:actor  as text))
              and (cast(:entity as text) is null or a.entity = cast(:entity as text))
              and (cast(:action as text) is null or a.action = cast(:action as text))
              and (cast(:actorRole as text) is null or a.actor_role = cast(:actorRole as text))
              and (cast(:from as timestamptz) is null or a.at >= cast(:from as timestamptz))
              and (cast(:to   as timestamptz) is null or a.at <  cast(:to   as timestamptz))
              and (cast(:q as text) is null
                   or lower(coalesce(u.name, '') || ' ' || a.action || ' ' || a.entity
                            || ' ' || coalesce(a.entity_id, '')) like cast(:q as text))
            """;

    private static final String JOIN = """
            from audit_log a
            left join users u on u.id::text = a.actor
            where
            """ + BACK_OFFICE + "\n" + FILTERS;

    private static final String FEED = """
            select a.id, coalesce(u.name, a.actor), a.actor_role,
                   a.action, a.entity, a.entity_id, a.at, a.metadata::text
            """ + JOIN + """
            order by a.at desc
            limit :limit offset :offset
            """;

    private static final String TOTAL = "select count(*) " + JOIN;

    private static final String DISTINCT_ACTORS = "select count(distinct a.actor) " + JOIN;

    private static final String BY_ENTITY = "select a.entity, count(*) " + JOIN + """
            group by a.entity
            order by count(*) desc, a.entity
            """;

    private static final String ACTIONS = "select distinct a.action " + JOIN + " order by a.action";

    private static final String LEADERBOARD = """
            select a.actor, coalesce(u.name, a.actor), a.actor_role, u.team, count(*)
            """ + JOIN + """
            group by a.actor, u.name, a.actor_role, u.team
            order by count(*) desc, coalesce(u.name, a.actor)
            limit :cap
            """;

    private final EntityManager em;

    StaffActivityRepository(EntityManager em) {
        this.em = em;
    }

    List<StaffActivityEntry> feed(StaffActivityFilter filter, int limit, int offset, boolean withMetadata) {
        Query query = bind(em.createNativeQuery(FEED), filter);
        query.setParameter("limit", limit);
        query.setParameter("offset", offset);
        List<StaffActivityEntry> out = new ArrayList<>();
        for (Object row : query.getResultList()) {
            Object[] cells = (Object[]) row;
            out.add(new StaffActivityEntry(
                    text(cells[0]),
                    text(cells[1]),
                    text(cells[2]),
                    text(cells[3]),
                    text(cells[4]),
                    text(cells[5]),
                    toInstant(cells[6]),
                    withMetadata ? AuditMetadata.parse(text(cells[7])) : null));
        }
        return out;
    }

    long total(StaffActivityFilter filter) {
        return ((Number) bind(em.createNativeQuery(TOTAL), filter).getSingleResult()).longValue();
    }

    long distinctActors(StaffActivityFilter filter) {
        return ((Number) bind(em.createNativeQuery(DISTINCT_ACTORS), filter).getSingleResult()).longValue();
    }

    List<StaffActivityCount> byEntity(StaffActivityFilter filter) {
        List<StaffActivityCount> out = new ArrayList<>();
        for (Object row : bind(em.createNativeQuery(BY_ENTITY), filter).getResultList()) {
            Object[] cells = (Object[]) row;
            out.add(new StaffActivityCount(text(cells[0]), ((Number) cells[1]).longValue()));
        }
        return out;
    }

    List<String> actions(StaffActivityFilter filter) {
        List<String> out = new ArrayList<>();
        for (Object row : bind(em.createNativeQuery(ACTIONS), filter).getResultList()) {
            out.add(text(row));
        }
        return out;
    }

    List<StaffLeaderboardEntry> leaderboard(StaffActivityFilter filter, int cap) {
        Query query = bind(em.createNativeQuery(LEADERBOARD), filter);
        query.setParameter("cap", cap);
        List<StaffLeaderboardEntry> out = new ArrayList<>();
        for (Object row : query.getResultList()) {
            Object[] cells = (Object[]) row;
            out.add(new StaffLeaderboardEntry(
                    text(cells[0]),
                    text(cells[1]),
                    text(cells[2]),
                    text(cells[3]),
                    ((Number) cells[4]).longValue()));
        }
        return out;
    }

    /** Bound as ISO text and cast in SQL: a null {@code Instant} gives the driver no type to send. */
    private static Query bind(Query query, StaffActivityFilter filter) {
        query.setParameter("actor", filter.actor());
        query.setParameter("entity", filter.entity());
        query.setParameter("action", filter.action());
        query.setParameter("actorRole", filter.actorRole());
        query.setParameter("from", filter.from() == null ? null : filter.from().toString());
        query.setParameter("to", filter.to() == null ? null : filter.to().toString());
        query.setParameter("q", filter.like());
        return query;
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
