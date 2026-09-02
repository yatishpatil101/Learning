package com.draazy.api.admin.staff;

import java.time.Instant;

/**
 * One back-office action, with the colleague who performed it resolved to a name.
 *
 * <p>The mock this replaces kept its own parallel log, written in the browser at the moment an
 * action succeeded. That design cannot record an action that failed, cannot record one taken through
 * any other client, and disappears when the tab's storage is cleared — three ways of quietly
 * flattering the team it was built to review. This record is a projection of {@code audit_log}, which
 * is written by the server inside the transaction that did the work.
 *
 * @param id       the audit row's own id, so the feed can be reconciled against the audit log
 * @param actor    the acting user's id, and the value the {@code actor} filter takes
 * @param actorName the acting user's name, or the raw actor handle if no account matches — an
 *                  actor whose account has since been deleted still has to appear
 * @param actorRole {@code staff} or {@code admin}; consumer actions are not staff activity
 * @param actorTeam the team the actor belonged to, or {@code null}
 * @param action   the dotted verb, e.g. {@code user.suspend}
 * @param entity   the kind of record acted on, e.g. {@code user} — the feed's category
 * @param entityId the record acted on
 * @param at       when it happened
 */
public record StaffActivityEntry(
        String id,
        String actor,
        String actorName,
        String actorRole,
        String actorTeam,
        String action,
        String entity,
        String entityId,
        Instant at) {
}
