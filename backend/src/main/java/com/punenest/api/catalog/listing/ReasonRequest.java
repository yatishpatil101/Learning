package com.punenest.api.catalog.listing;

/**
 * Optional reason body for archive/moderation actions (contract {@code ReasonRequest}). The action's
 * request body is optional, so {@code reason} may be {@code null} (no reason given) — the audit
 * string is best-effort, not a gate.
 *
 * @param reason free-text justification, nullable
 */
public record ReasonRequest(String reason) {
}
