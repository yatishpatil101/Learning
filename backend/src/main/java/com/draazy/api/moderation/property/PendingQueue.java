package com.draazy.api.moderation.property;

import com.draazy.api.catalog.property.PropertyStatus;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Slim reads of the verification queue for the bell and the dashboard, which render four fields and
// two counts; the full admin row is ten times the size.
@Service
public class PendingQueue {

    public record Row(String id, String title, String locality, Long price, String owner) {
    }

    public record Counts(long pending, long flagged, long followUp) {
    }

    // id desc is the admin search's own tiebreak, so these rows line up with that list.
    private static final String ROWS = """
            select p.id, p.title, p.locality, p.price, o.name
              from Property p join p.owner o
             where p.status = :pending and p.archived = false
             order by p.createdAt %s, p.id desc
            """;

    // Follow-up = waiting past the cutoff, or posted by staff and not yet confirmed by its owner.
    private static final String COUNTS = """
            select sum(case when p.status = :pending then 1 else 0 end),
                   sum(case when p.status = :flagged then 1 else 0 end),
                   sum(case when p.status = :pending
                             and (p.createdAt < :staleBefore
                                  or (p.postedByAdmin = true and p.ownerConfirmedAt is null))
                            then 1 else 0 end)
              from Property p
             where p.archived = false
            """;

    private final EntityManager em;

    public PendingQueue(EntityManager em) {
        this.em = em;
    }

    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public List<Row> pending(int limit, boolean oldestFirst) {
        List<Object[]> rows = em.createQuery(ROWS.formatted(oldestFirst ? "asc" : "desc"))
                .setParameter("pending", PropertyStatus.PENDING)
                .setMaxResults(limit)
                .getResultList();
        return rows.stream()
                .map(r -> new Row(r[0].toString(), (String) r[1], (String) r[2], (Long) r[3],
                        (String) r[4]))
                .toList();
    }

    @Transactional(readOnly = true)
    public Counts counts(Instant staleBefore) {
        Object[] r = (Object[]) em.createQuery(COUNTS)
                .setParameter("pending", PropertyStatus.PENDING)
                .setParameter("flagged", PropertyStatus.FLAGGED)
                .setParameter("staleBefore", staleBefore)
                .getSingleResult();
        return new Counts(n(r[0]), n(r[1]), n(r[2]));
    }

    private static long n(Object value) {
        return value instanceof Number number ? number.longValue() : 0L;
    }
}
