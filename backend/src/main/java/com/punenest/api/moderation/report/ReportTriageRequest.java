package com.punenest.api.moderation.report;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * {@code PATCH /reports/{id}} body (contract {@code ReportTriage}, spec fix S30).
 *
 * <p>{@code note} is an internal ops note. It is written to the audit log rather than to the report
 * row, because the report is the reporter's statement and this is the moderator's — keeping them in
 * separate records means a triage note can never be mistaken for something the reporter said, and
 * the note is attributable to whoever typed it.
 */
public record ReportTriageRequest(
        @NotBlank String status,
        @Size(max = 2000) String note) {
}
