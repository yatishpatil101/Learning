package com.draazy.api.moderation.report;

import java.time.Instant;

/**
 * {@code Report} on the wire.
 *
 * <p>Mirrors the contract schema exactly, which means it deliberately omits {@code reporterId}. The
 * queue tells a moderator what was complained about and why, not who complained: naming the reporter
 * to every member of ops is how a complaint becomes a reprisal, and no moderation decision here
 * depends on the reporter's identity. It stays on the row for the duplicate check and the audit
 * trail.
 *
 * <p>The frontend mock ({@code lib/data/reports.js}) additionally denormalises display fields —
 * {@code targetTitle}, {@code targetOwner}, {@code reportedBy}, {@code reasonLabel}. None is added
 * here: the contract does not declare them, three of the four are joins the admin UI can make for
 * itself, and {@code reasonLabel} is presentation text that belongs with the vocabulary the client
 * already ships.
 */
public record ReportResponse(
        String id,
        String targetType,
        String targetId,
        String reason,
        String details,
        String status,
        Instant createdAt) {
}
