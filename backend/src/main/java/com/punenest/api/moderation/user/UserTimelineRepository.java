package com.punenest.api.moderation.user;

import jakarta.persistence.EntityManager;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Repository;

/**
 * One person's activity across the platform, as native SQL.
 *
 * <p><strong>Why this is one query and not five repository calls.</strong> The console's activity
 * modal is a single chronological list; producing it through {@code ContactRequestRepository},
 * {@code VisitRepository}, {@code ServiceRequestRepository}, {@code PropertyRepository} and
 * {@code AuditLogRepository} would mean five new {@code findBy…} methods that exist for one screen,
 * five real Java dependencies from {@code moderation} onto five other contexts, and — the part that
 * actually decides it — no way to apply the row cap before the rows are loaded. "Newest fifty
 * things this person did" cannot be answered by taking fifty from each source and throwing most of
 * them away; the ordering is across the union, not within it. Same reasoning as
 * {@code AdminMetricsRepository}, which this deliberately mirrors.
 *
 * <p>The cost is the same too, and worth naming: a column rename in another context breaks this at
 * runtime rather than at compile time. {@code UserTimelineEndpointTest} is what catches it.
 *
 * <p><strong>Everything is keyed on a foreign key, never on a mobile number.</strong> The console's
 * client-side version joined by phone number because the browser's copy of the database had nothing
 * better; that silently attributes one person's enquiries to another the moment two accounts share
 * a number, which happens on this platform every time somebody re-registers. Every source below
 * carries a real {@code user_id}, so the join is exact.
 */
@Repository
class UserTimelineRepository {

    /**
     * The union. Column order is fixed and read positionally by {@link #timeline}: {@code kind},
     * {@code entityId}, {@code at}, {@code label}, {@code status}.
     *
     * <p><strong>Ordering is by {@code created_at} everywhere, including for visits.</strong> A
     * visit also has a {@code slot}, which is when it is <em>scheduled</em> for and may be in the
     * future. Mixing the two would put next Tuesday's viewing above last week's enquiry in a list
     * that claims to be a history, so the slot travels as the label and the ordering stays on the
     * moment the person acted.
     *
     * <p><strong>Listings are included for any role, not just owners.</strong> The client-side
     * version gated on {@code role = 'owner'}, which hid every listing belonging to somebody whose
     * role was later corrected — precisely the account a moderator is looking at.
     */
    private static final String TIMELINE = """
            select 'account' as kind, cast(u.id as text) as entity_id, u.created_at as at,
                   u.role as label, u.status as status
              from users u
             where u.id = :userId
            union all
            select 'enquiry', cast(c.id as text), c.created_at,
                   coalesce(p.title, ''), c.status
              from contact_requests c
              left join properties p on p.id = c.property_id
             where c.requester_id = :userId
            union all
            select 'visit', cast(v.id as text), v.created_at,
                   coalesce(p.title, ''), v.status
              from visits v
              left join properties p on p.id = v.property_id
             where v.visitor_id = :userId
            union all
            select 'service', cast(s.id as text), s.created_at, s.type, s.status
              from service_requests s
             where s.requester_id = :userId
            union all
            select 'listing', cast(p.id as text), p.created_at, p.title, p.status
              from properties p
             where p.owner_id = :userId
            union all
            select 'moderation', a.entity_id, a.at, a.action, null
              from audit_log a
             where a.entity = 'user'
               and a.entity_id = cast(:userId as text)
            order by at desc
            limit :cap
            """;

    private final EntityManager em;

    UserTimelineRepository(EntityManager em) {
        this.em = em;
    }

    /**
     * The newest {@code cap} events for one person, newest first.
     *
     * <p>Capped rather than paged on purpose. This is a "what has this person been doing" glance
     * taken while deciding whether to suspend them, not a ledger — and a page-two affordance on a
     * six-way union would need a stable sort key the union does not have (two rows created in the
     * same millisecond in different tables have no defined order between them, so a keyset cursor
     * could skip or repeat one). If the full history is ever genuinely needed it belongs in an
     * export, not behind a "load more".
     */
    @SuppressWarnings("unchecked")
    List<UserTimelineEntry> timeline(UUID userId, int cap) {
        List<Object[]> rows = em.createNativeQuery(TIMELINE)
                .setParameter("userId", userId)
                .setParameter("cap", cap)
                .getResultList();
        return rows.stream().map(UserTimelineRepository::toEntry).toList();
    }

    private static UserTimelineEntry toEntry(Object[] row) {
        return new UserTimelineEntry(
                (String) row[0],
                (String) row[1],
                toInstant(row[2]),
                (String) row[3],
                (String) row[4]);
    }

    /**
     * The JDBC driver hands back a {@code Timestamp} for a {@code timestamptz} column, and Hibernate
     * does not map it for a native query returning {@code Object[]}. Handled here rather than in the
     * service so the DTO is never constructed from a raw driver type.
     */
    private static Instant toInstant(Object value) {
        if (value instanceof Instant instant) {
            return instant;
        }
        return value instanceof Timestamp ts ? ts.toInstant() : null;
    }
}
