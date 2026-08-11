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
 *
 * @param enforcement what to actually do to the target — see {@link ReportEnforcement}. Optional,
 *     and {@code null} means {@link ReportEnforcement#NONE}, because that is what every caller
 *     written before the field existed meant: decide the complaint, touch nothing. Making it
 *     required would have turned every one of those callers into a 422 on the day this shipped, for
 *     no gain — the dangerous default is the one that acts, not the one that does not.
 */
public record ReportTriageRequest(
        @NotBlank String status,
        @Size(max = 2000) String note,
        String enforcement) {

    /** The enforcement asked for, with {@code null} or blank read as {@link ReportEnforcement#NONE}. */
    public String enforcementOrNone() {
        return (enforcement == null || enforcement.isBlank()) ? ReportEnforcement.NONE : enforcement;
    }
}
