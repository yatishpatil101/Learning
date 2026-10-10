package com.draazy.api.moderation.report;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/** Omits {@code reporterId} on purpose: naming the reporter to ops turns a complaint into a reprisal,
 * and no moderation decision depends on it. */
public record ReportResponse(
        String id,
        String targetType,
        String targetId,
        String reason,
        String details,
        String status,
        Instant createdAt,
        @JsonInclude(JsonInclude.Include.NON_NULL) Long targetReportCount) {

    /** Only {@code GET /reports} rows carry the tally of reports on the same target. */
    ReportResponse withTargetReportCount(long count) {
        return new ReportResponse(id, targetType, targetId, reason, details, status, createdAt, count);
    }
}
