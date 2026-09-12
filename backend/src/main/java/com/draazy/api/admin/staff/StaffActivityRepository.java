package com.draazy.api.admin.staff;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Repository;

/**
 * Reads back-office activity out of {@code audit_log}.
 *
 * <p>Native SQL, like everything else in {@code admin}: this package sits at the top of the layer
 * map with no outgoing edges, so it may not reach into the modules whose records it counts. That is
 * the point of it. A reporting read that imported {@code moderation} and {@code catalog} to build
 * the same numbers would make every one of them a reason not to change those modules.
 *
 * <p>The join to {@code users} is {@code u.id::text = a.actor} rather than a cast the other way.
 * {@code actor} is a free-text handle — a user id for anything the back-office does, but the column
 * is not a foreign key and older rows may hold a mobile number, so casting it to {@code uuid} would
 * fail the whole query on one malformed row. Comparing as text degrades instead: an unmatched actor
 * shows up under its raw handle, which is worse to read and better than a 500.
 */
@Repository
class StaffActivityRepository {

    /**
     * Consumers write audit rows too — {@code user.contact.reveal} is recorded against whoever
     * asked. This is a staff review, so the feed is scoped to back-office roles at the SQL level
     * rather than in a filter the caller could omit.
     */
    private static final String BACK_OFFICE = "a.actor_role in ('staff', 'admin')";

    private static final String FILTERS = """
              and (cast(:actor  as text) is null or a.actor  = cast(:actor  as text))
              and (cast(:entity as text) is null or a.entity = cast(:entity as text))
              and (cast(:action as text) is null or a.action = cast(:action as text))
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
            select a.id, a.actor, coalesce(u.name, a.actor), a.actor_role, u.team,
                   a.action, a.entity, a.entity_id, a.at
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

    List<StaffActivityEntry> feed(StaffActivityFilter filter, int limit, int offset) {
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
                    text(cells[6]),
                    text(cells[7]),
                    toInstant(cells[8])));
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

    /**
     * Time bounds are bound as ISO text and cast in SQL rather than bound as {@code Instant}. A null
     * {@code Instant} on a native query leaves the driver with no type to send, and Postgres answers
     * "could not determine data type" — for the unfiltered case, which is the default.
     */
    private static Query bind(Query query, StaffActivityFilter filter) {
        query.setParameter("actor", filter.actor());
        query.setParameter("entity", filter.entity());
        query.setParameter("action", filter.action());
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
