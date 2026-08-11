package com.punenest.api.admin;

/**
 * Contract schema {@code AdminKpis} — the ops scorecard.
 *
 * @param pendingModeration listings awaiting a verification decision. Deliberately does <em>not</em>
 *     fold in abuse reports: the two queues are worked by different people against different SLAs,
 *     and one number covering both would be a figure neither desk could act on.
 * @param openReports complaints still awaiting a decision ({@code open} or {@code reviewing}) — the
 *     second queue tile tech debt D68 was waiting for. It is a separate field for the reason above,
 *     and it exists at all because the scorecard is the one screen ops looks at, and until now the
 *     abuse backlog was not on it in any form: a queue that only privileged people can empty, whose
 *     depth was invisible on the only dashboard those people open.
 * @param revenue30d null for staff. The dashboard is staff-visible but {@code /admin/finance} is
 *     admin-only, so serving a revenue figure to staff here would contradict the very next
 *     operation in the contract (spec fix S61).
 */
public record AdminKpis(
        long totalListings,
        long activeListings,
        long pendingModeration,
        long openReports,
        long totalUsers,
        long newUsers7d,
        long dealsClosed30d,
        Long revenue30d) {
}
