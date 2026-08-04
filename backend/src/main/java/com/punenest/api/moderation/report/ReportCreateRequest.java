package com.punenest.api.moderation.report;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /reports} body (contract {@code ReportCreate}).
 *
 * <p>Note what is <em>not</em> here: the reporter. The contract does not carry one and neither does
 * this record — identity comes from the authenticated principal. A body field naming the reporter
 * would let anyone file a complaint under somebody else's name, which turns an abuse queue into an
 * abuse vector.
 *
 * <p>{@code targetType} and {@code reason} are checked for presence here and for membership of the
 * per-target-type vocabulary in the service, where both values are in hand ({@link ReportReasons}).
 */
public record ReportCreateRequest(
        @NotBlank String targetType,
        @NotBlank @Size(max = 200) String targetId,
        @NotBlank @Size(max = 64) String reason,
        @Size(max = 4000) String details) {
}
