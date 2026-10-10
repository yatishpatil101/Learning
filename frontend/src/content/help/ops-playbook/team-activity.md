---
title: Team activity review
slug: team-activity
category: ops-playbook
audience: staff
access: staff
order: 27
updated: 2026-10-10
summary: How managers read queue health and the staff activity log, and what to follow up on.
tags: [ops, internal, team, audit, managers]
modules: [staffActivity]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Performance** tab, **Queues**: the open count for each function. A count above 0 turns amber.
- The "Oldest ..." line under each count. It tells you how long the longest waiting item has been there.
- **Staff · last 7 days**: anyone with a very low **handled** number compared with the rest of the team.
- **Activity log**: actions in categories that do not match what that person normally does.
- A sudden burst of actions by one person in a short time.

**Work on**

- Move work to a colleague when one queue is old and another is empty.
- Ask the person about any action you do not understand. Ask before you assume.
- Ask an admin to change functions in **Team & Access** when someone is working outside their role or needs more access.
- Weekly: switch **Performance** to **30 days** and note who handled what, per function.
- Pass anything that looks like misuse to an admin. Do not confront the person first.

## Desk and access

Use **Team Activity** at `/admin/staff-activity`. It needs `audit:read`, which managers and admins have. Staff accounts cannot open it. The page is read-only: it cannot change or delete any record.

An admin can switch the module off in **Settings → Feature flags → Admin Modules**. The page then says "Team Activity module is disabled" with a link to Settings.

What you see depends on your role:

| Role | **Performance** tab | **Activity log** tab |
| --- | --- | --- |
| Manager | Yes | Actions by staff accounts only; no **Details** column |
| Admin | Yes | Staff, managers and admins, plus a **Details** column. The **Actors** chips switch between **Back-office** and **All actors** |

## Performance tab

Pick **7 days** or **30 days**. Those are the only two windows.

| Block | What it shows |
| --- | --- |
| **Queues** | One tile per function: open items, how long the oldest has waited ("Nothing waiting" if empty), and a median decision time where one exists (identity and property verification only) |
| **Staff** | Each active staff member and a **handled** count for the window. Open a row to see their functions and a count per function. "No functions" means none are granted |

What counts as open:

| Queue | Open means |
| --- | --- |
| KYC review | Identity checks waiting for review |
| Property verification | Listings waiting for a verification decision or an ownership check |
| Listing moderation | Listings waiting for approval |
| Support | Tickets the staff have not read yet, that are not resolved or closed |
| Reports | Reports that are open or being reviewed |
| Each service desk | Requests and tickets that are still in progress, not completed or cancelled |

**Handled** is the number of audited actions the person took. It is not the number of cases closed. Per-function counts only include actions the system can match to a function, so they may add up to less than **handled**.

## Activity log tab

| Control | What it does |
| --- | --- |
| **Total activities**, **Active staff** | Counts for what is currently filtered, then the two busiest categories |
| **Search staff, action or record…** | Searches name, action and record id |
| **Filter by staff**, **Filter by category**, **Filter by action** | The pickers keep every choice for the date range and search, so they do not shrink as you filter |
| **All**, **Today**, **7d**, **30d** | Date range |
| **Clear** | Resets every filter |
| **Previous** / **Next** | 50 rows per page |

Each row shows who did it, the category and action, and the record id. A property row has a link to **Properties**. Only actions the platform audits appear here.

The admin **All actors** view is a separate read-only trail, 12 rows per page, with **Export CSV**. The export covers the whole trail, newest first, up to 5,000 entries. If the trail is longer, the confirmation says how many were exported.

## Steps: weekly check

1. Open **Performance**, choose **30 days**, and open each staff row.
2. Compare each person's functions with the work they handled. Note large gaps.
3. Open **Activity log**, choose **30d**, and filter by one person. Read a page of their actions.
4. For anything odd, search the record id to see who else touched it.
5. Send your notes to an admin if access needs to change or something looks wrong.

## Never do

- Do not rank people on **handled** alone. A hard case can take many actions or one.
- Do not share exports or screenshots outside the managers and admins who need them.
- Do not read a missing row as proof something did not happen. Only audited actions appear.
- Do not ask a colleague for their login. The log records who did each action.

## Related

- [Staff desks](/help/a/staff-desks)
- [Analytics review](/help/a/analytics-review)
- [Verification SLAs](/help/a/verification-sla)
- [Ticket handling and escalation](/help/a/ticket-escalation)
