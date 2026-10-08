---
title: Reports and takedowns
slug: reports-and-takedowns
category: ops-playbook
audience: staff
access: staff
order: 5
updated: 2026-10-04
summary: Internal trust and safety procedure for report triage, chat reports, takedowns and dismissals.
tags: [ops, reports, takedowns, internal]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Desk and access

Use **Admin → Reports** (`/admin/reports`) for Trust & Safety triage. It is an admin-portal desk: you need an `admin` account holding `reports:read` to view and `reports:write` to decide.

Users can file listing reports, user reports and review reports. Chat can open a **Report user** modal for one-to-one conversations; group conversations do not expose user blocking or reporting.

## Queue tabs and filters

| Tab | Target types | Available enforcement |
| --- | --- | --- |
| **Listings** | Property listings | **Take down** with `hide_content` |
| **Users** | User or owner account reports | **Suspend** with `suspend_account` |
| **Flatmate posts** | Share posts | Decide the report; share-flat posts have no report-queue takedown verb |

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
3. Treat a **3x** badge as escalation signal; it means at least three reports hit the same target.
4. Compare the report against the target in its owning desk before taking it down.
5. Choose **Take down**, **Suspend**, **Remove**, **Resolve** or **Dismiss**.
6. Write an internal note when the decision is not obvious from the reason and target.

Reporter identity is withheld from the queue and export. Use **Withheld** in notes; do not call the reporter anonymous if the system withheld them.

## Enforcement effects

| Button | Backend effect |
| --- | --- |
| **Take down** on listing | Flags the listing and removes it from public search |
| **Suspend** on user | Suspends or archives the user through admin user enforcement |
| **Resolve** | Stores a dismissed report with reviewed-no-action wording |
| **Dismiss** | Stores a dismissed report without enforcement |

Review reports are not decided here. Use the review status route or the owning review desk. Flatmate and share-post reports have no backend takedown verb from this queue; decide the report and escalate the post separately.

## Chat blocks and reports

Blocking in Messages is pair-only. It prevents messaging both ways for that pair and can be undone with unblock. Deleting a message hides it only for the current user.

Use chat user reports like any other user report: inspect the target, look for repeat reports, and suspend only when account-level action is justified.

## Never do in reports and takedowns

- Do not reopen a decided report.
- Do not expose reporter identity in a note or export.
- Do not use account suspension for content that only needs content removal.
- Do not use **Resolve** for an unsafe target just because another desk must finish the action.
- Do not promise flatmate, review or society enforcement unless the owning desk reflects the action.

## Related

- [Ticket handling and escalation](/help/a/ticket-escalation)
- [Verification SLAs](/help/a/verification-sla)
- [Flatmate review](/help/a/flatmate-review)
