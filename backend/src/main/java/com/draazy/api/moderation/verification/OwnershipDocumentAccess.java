package com.draazy.api.moderation.verification;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class OwnershipDocumentAccess {

    private final JdbcTemplate jdbc;

    OwnershipDocumentAccess(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    boolean mayRead(UUID propertyId, Instant now) {
        return jdbc.query("""
                select r.status, r.decided_at, r.needs_info_timeout_archived_at,
                       p.archived, p.archived_at
                from property_reviews r
                join properties p on p.id = r.property_id
                where r.property_id = ?
                """, (rs, rowNum) -> new CaseWindow(rs.getString("status"),
                        rs.getBoolean("archived"), instant(rs, "decided_at"),
                        instant(rs, "archived_at"),
                        instant(rs, "needs_info_timeout_archived_at")), propertyId).stream()
                .findFirst()
                .map(row -> row.open() || row.withinDecisionWindow(now))
                .orElse(false);
    }

    private static Instant instant(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        java.sql.Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private record CaseWindow(String status, boolean archived, Instant decidedAt, Instant archivedAt,
            Instant autoArchivedAt) {
        boolean open() {
            return !archived
                    && ("pending".equals(status) || "in_review".equals(status) || "needs_info".equals(status));
        }

        boolean withinDecisionWindow(Instant now) {
            return Optional.ofNullable(latest(decidedAt, archivedAt, autoArchivedAt))
                    .map(at -> !at.plus(30, ChronoUnit.DAYS).isBefore(now))
                    .orElse(false);
        }

        private static Instant latest(Instant first, Instant second, Instant third) {
            Instant latest = first;
            if (second != null && (latest == null || second.isAfter(latest))) {
                latest = second;
            }
            if (third != null && (latest == null || third.isAfter(latest))) {
                latest = third;
            }
            return latest;
        }
    }
}
