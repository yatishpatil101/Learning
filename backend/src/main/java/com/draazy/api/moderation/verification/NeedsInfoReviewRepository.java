package com.draazy.api.moderation.verification;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class NeedsInfoReviewRepository {

    private final NamedParameterJdbcTemplate jdbc;

    NeedsInfoReviewRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    List<NeedsInfoCase> findDue(Instant firstReminderCutoff, Instant day7Cutoff, Instant day14Cutoff, int limit) {
        return jdbc.query("""
                select r.id review_id, r.property_id, p.owner_id, p.info_requested_at needs_info_at,
                       r.needs_info_day2_reminded_at, r.needs_info_day7_reminded_at,
                       r.needs_info_timeout_archived_at
                from property_reviews r
                join properties p on p.id = r.property_id
                where r.status = 'needs_info'
                  and p.info_requested_at is not null
                  and p.status = 'pending'
                  and p.archived = false
                  and (
                    (p.info_requested_at <= :day14Cutoff
                     and (r.needs_info_timeout_archived_at is null
                          or r.needs_info_timeout_archived_at < p.info_requested_at))
                    or (p.info_requested_at <= :day7Cutoff
                        and (r.needs_info_day7_reminded_at is null
                             or r.needs_info_day7_reminded_at < p.info_requested_at))
                    or (p.info_requested_at <= :firstReminderCutoff
                        and (r.needs_info_day2_reminded_at is null
                             or r.needs_info_day2_reminded_at < p.info_requested_at))
                  )
                order by p.info_requested_at asc
                limit :limit
                for update of r skip locked
                """, Map.of(
                "firstReminderCutoff", Timestamp.from(firstReminderCutoff),
                "day7Cutoff", Timestamp.from(day7Cutoff),
                "day14Cutoff", Timestamp.from(day14Cutoff),
                "limit", limit), this::caseRow);
    }

    boolean markFirstReminder(NeedsInfoCase row, Instant now) {
        return mark(row, now, """
                update property_reviews
                set needs_info_day2_reminded_at = :now
                where id = :reviewId
                  and status = 'needs_info'
                  and (select p.info_requested_at from properties p where p.id = property_id) = :needsInfoAt
                  and (needs_info_day2_reminded_at is null
                       or needs_info_day2_reminded_at < :needsInfoAt)
                """);
    }

    boolean markDay7Reminder(NeedsInfoCase row, Instant now) {
        return mark(row, now, """
                update property_reviews
                set needs_info_day7_reminded_at = :now,
                    needs_info_day2_reminded_at =
                        case when needs_info_day2_reminded_at is null
                                  or needs_info_day2_reminded_at < :needsInfoAt
                             then :now
                             else needs_info_day2_reminded_at
                        end
                where id = :reviewId
                  and status = 'needs_info'
                  and (select p.info_requested_at from properties p where p.id = property_id) = :needsInfoAt
                  and (needs_info_day7_reminded_at is null
                       or needs_info_day7_reminded_at < :needsInfoAt)
                """);
    }

    boolean markAutoArchived(NeedsInfoCase row, Instant now) {
        return mark(row, now, """
                update property_reviews
                set needs_info_timeout_archived_at = :now,
                    needs_info_day2_reminded_at =
                        case when needs_info_day2_reminded_at is null
                                  or needs_info_day2_reminded_at < :needsInfoAt
                             then :now
                             else needs_info_day2_reminded_at
                        end,
                    needs_info_day7_reminded_at =
                        case when needs_info_day7_reminded_at is null
                                  or needs_info_day7_reminded_at < :needsInfoAt
                             then :now
                             else needs_info_day7_reminded_at
                        end
                where id = :reviewId
                  and status = 'needs_info'
                  and (select p.info_requested_at from properties p where p.id = property_id) = :needsInfoAt
                  and (needs_info_timeout_archived_at is null
                       or needs_info_timeout_archived_at < :needsInfoAt)
                """);
    }

    private boolean mark(NeedsInfoCase row, Instant now, String sql) {
        int updated = jdbc.update(sql, Map.of(
                "now", Timestamp.from(now),
                "reviewId", row.reviewId(),
                "needsInfoAt", Timestamp.from(row.needsInfoAt())));
        return updated == 1;
    }

    private NeedsInfoCase caseRow(ResultSet rs, int rowNum) throws SQLException {
        return new NeedsInfoCase(
                rs.getObject("review_id", UUID.class),
                rs.getObject("property_id", UUID.class),
                rs.getObject("owner_id", UUID.class),
                instant(rs, "needs_info_at"),
                instant(rs, "needs_info_day2_reminded_at"),
                instant(rs, "needs_info_day7_reminded_at"),
                instant(rs, "needs_info_timeout_archived_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        java.sql.Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    record NeedsInfoCase(
            UUID reviewId,
            UUID propertyId,
            UUID ownerId,
            Instant needsInfoAt,
            Instant day2RemindedAt,
            Instant day7RemindedAt,
            Instant timeoutArchivedAt) {
    }
}
