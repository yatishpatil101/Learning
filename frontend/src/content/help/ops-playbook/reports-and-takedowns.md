---
title: Reports and takedowns
slug: reports-and-takedowns
category: ops-playbook
audience: staff
access: staff
order: 5
updated: 2026-10-10
summary: Internal trust and safety procedure for report triage, chat reports, takedowns and dismissals.
tags: [ops, reports, takedowns, internal]
modules: [reports]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- Tab counts on **Properties**, **Users & owners** and **Flatmate posts** ? reports not yet decided.
- **Open** status chip ? nobody has decided it. **Being reviewed** may be with a colleague.
- A red **3x** badge or higher ? three or more reports hit the same target. Treat it as an escalation signal.
- **Reviews** tab, if you hold review access ? pending reviews to approve or reject.

**Work on**

- Filter **Open** and read **View details** before you act on any report.
- Choose **Take down**, **Suspend**, **Resolve** or **Dismiss**; add a note when the reason is not obvious.
- Use **Bulk Resolve** or **Bulk Dismiss** only on clearly no-action reports.
- On **Reviews**, **Approve** or **Reject** each pending review.

## Desk and access

Use **Admin → Reports** (`/admin/reports`) for Trust & Safety triage. You need the **Reports** function (`reports:read` to view, `reports:write` to decide); staff open it under `/staff/reports`.

Users can file listing reports, user reports and review reports. Chat can open a **Report user** modal for one-to-one conversations; group conversations do not expose user blocking or reporting.

## Queue tabs and filters

| Tab | Target types | Available enforcement |
| --- | --- | --- |
| **Properties** | Property listings | **Take down** with `hide_content` |
| **Users & owners** | User or owner account reports | **Suspend** with `suspend_account` |
| **Flatmate posts** | Rooms, groups and seeker posts | **Take down** with `hide_content` |
| **Reviews** | User reviews on listings and societies | **Approve** / **Reject** (not a report; see below) |

Filter by status, reason and date range. Search only after checking whether an old tab or reason filter is hiding rows.

## Report states

| Server state | Staff label | Rule |
| --- | --- | --- |
| `open` | Open | Can be decided |
| `reviewing` | Being reviewed | Can be filtered; another moderator may be handling it |
| `actioned` | Action taken | Terminal |
| `dismissed` | Dismissed | Terminal |

The UI label **Resolve** sends a reviewed-no-action decision that stores as `dismissed`. A terminal report cannot be reopened; file a fresh report if the problem recurs.

## Triage procedure

1. Open **View details** before acting.
2. Read the reason, target title, target type and any repeat-target badge.
3. Treat an **Nx** badge (N = 3 or more) as an escalation signal; it means that many reports hit the same target.
4. Compare the report against the target in its owning desk before taking it down.
5. Choose **Take down**, **Suspend**, **Resolve** or **Dismiss**. **Bulk Resolve** and **Bulk Dismiss** act on the rows you tick; use them only for clearly no-action reports.
6. Write an internal note when the decision is not obvious from the reason and target.

Reporter identity is withheld from the queue and export. Use **Withheld** in notes; do not call the reporter anonymous if the system withheld them.

## Enforcement effects

| Button | Backend effect |
| --- | --- |
| **Take down** on listing | Flags the listing and removes it from public search |
| **Suspend** on user | Suspends or archives the user through admin user enforcement |
| **Take down** on flatmate post | Sets the post to removed; the author is not suspended |
| **Resolve** | Stores a dismissed report with reviewed-no-action wording |
| **Dismiss** | Stores a dismissed report without enforcement |

The **Reviews** tab is a moderation list, not reports: filter Pending / Published / Rejected and use **Approve** (publishes) or **Reject** (hides the text and drops it from the rating). It shows only to accounts that also hold `properties:read`.

## Chat blocks and reports

Blocking in Messages is pair-only. It prevents messaging both ways for that pair and can be undone with unblock. Deleting a message hides it only for the current user.

Use chat user reports like any other user report: inspect the target, look for repeat reports, and suspend only when account-level action is justified.

## Never do in reports and takedowns

- Do not reopen a decided report.
- Do not expose reporter identity in a note or export.
- Do not use account suspension for content that only needs content removal.
- Do not use **Resolve** for an unsafe target just because another desk must finish the action.
- Do not promise society enforcement unless the Societies desk reflects the action.

## Related

- [Ticket handling and escalation](/help/a/ticket-escalation)
- [Verification SLAs](/help/a/verification-sla)
- [Flatmate review](/help/a/flatmate-review)
