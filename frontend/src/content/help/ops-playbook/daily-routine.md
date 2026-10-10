---
title: Daily routine - start and end of shift
slug: daily-routine
category: ops-playbook
audience: staff
access: staff
order: 1
updated: 2026-10-10
summary: What to check when you start a shift, how to use the Dashboard, the notification bell and Ctrl+K search, and how to hand over at the end.
tags: [ops, internal, dashboard, shift, handover]
modules: [dashboard]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- The Dashboard when you sign in. Staff see **Your work**. Managers and admins see the platform Dashboard.
- Every tile that is not **All clear**. Amber means something is waiting.
- The notification bell (red dot). It lights for notes sent to you and owner replies.
- The **Oldest** age on each of your queue tiles, not just the count.
- A dark notice on the bell or a tile that did not load. That means unknown, not empty.

**Work on**

- Your queue tiles first, oldest item first.
- Owner replies in the bell, so listings are not left waiting on you.
- Desks that have no tile (see the note below the table). Open them yourself.
- Anything you left half done yesterday.
- A short note on every case you could not finish, before you sign off.

## Desk and access

- Everyone in the panel can open the Dashboard. No function is needed.
- Staff sign in at `/staff/...`. Managers and admins use `/admin/...`. Links in the bell and search switch to the right one for you.
- A staff member with no function sees only the Dashboard. Ask your manager to grant a function in Team & Access.
- A desk you cannot open is hidden. That is by design, not a fault.

## The staff Dashboard ("Your work")

The header says **Your work** and your name. A **7 days / 30 days** toggle changes the "handled" numbers.

| Part | What it tells you |
|---|---|
| **Waiting for you** tile | Open items for one function. Shows the count (amber if above 0) and **Oldest** age, or **All clear**. Click it to open the desk. |
| **You handled N** | How many items you handled in the chosen period, per function. |
| "No work is assigned to you yet." | You have no function. Ask your manager. |
| "Your functions have no queue to work." | Your functions have no tile. Open their desks directly. |

Tiles exist only for these desks:

| Function | What the tile counts |
|---|---|
| Identity checks | Pending identity reviews |
| Property verification | Pending property reviews and ownership requests |
| Listing moderation | Pending listings |
| Support | Tickets with unread staff replies, not resolved or closed |
| Reports | Reports that are open or in review |
| Review moderation | Reviews awaiting moderation |
| Enquiries | Contact requests still pending |
| Flatmates | Flatmate posts, rooms, groups, applications and badge claims awaiting review |
| Societies | Member-added societies not yet merged or archived |
| Referrals | Referrals that are pending or qualified, awaiting a decision |
| Each service desk | Open service requests (not awaiting payment, draft shared, completed or cancelled) and open, in-progress or waiting tickets |

A tile with a count but no **Oldest** age reads **Waiting**. **No tile exists** for Users, Content, Localities, Analytics or Post on behalf. If you hold one of these, open the desk at the start of the shift and look for yourself.

## The manager and admin Dashboard

- **SLA health** (only if you have analytics access): Listing approval 24h, Ticket pickup 4h, Service delivery 3d, Concierge to live 7d. Green is 90% or more on time, amber 75-89%, red below 75%. Grey **Not recorded** means no data. **View full analytics** opens the SLA tab.
- **Needs attention**: Pending Verification, Needs Follow-up, Flagged Listings, Open Reports, New Enquiries, Scheduled Visits, Open Service Requests, Deals in Progress. Each opens its desk.
- **At a glance**: Total Users, Active Listings, Deals closed (30d), Signups today, Visits today. Revenue (last 30 days) shows for admins only.
- **Latest activity**: oldest pending verifications (5 rows, **View all**) and the latest service requests.
- A tile is hidden when you cannot open its desk. A tile at 0 reads **All clear**.

## Notification bell

Click the bell in the top bar.

| Section | Meaning |
|---|---|
| **For you** | Notes and alerts sent to you. **Mark all read** clears them. |
| **Owner replied** | An owner answered a verification question. Opens that listing. |
| **Pending verification** | Listings waiting for a check. Up to 5 shown. |
| **Open service requests** | Requests waiting on a desk. Up to 5 shown. |

- The red dot only lights for **For you** and **Owner replied**. Queues are work, not news, so they do not light it.
- It refreshes when you open it and about every 90 seconds while the tab is visible.
- **All caught up.** means nothing is waiting.
- **This bell is not counting anything here.** or **Part of this bell is dark here.** means a count failed. Open Properties and the service desks, which are the record.
- Queues show only if you can open Properties or Tickets.

## Search (Ctrl+K)

Press Ctrl+K (Cmd+K on Mac) on a computer to jump to the search box. On a phone, tap the search icon in the top bar. Press Esc to close.

- Type at least 2 characters. Chips: **All**, **Features**, **Listings**, **People**.
- Results: Pages, Features, Listings and People. Listings need Properties access. People need Users access.
- Every runbook is searchable under Features. Type its title.
- A notice that part of the search did not answer means some results are missing. Try again.

## Start of shift

1. Open the Dashboard. Note any tile that is not **All clear**.
2. Open the bell. Read **For you** and **Owner replied**.
3. Open your first desk from the tile, oldest item first.
4. Open desks with no tile.
5. If something looks wrong or old, follow the escalation rules in the staff desks runbook.

## End of shift

1. Finish or release what you hold. Do not leave a case claimed and untouched.
2. Write a short note on each open case: what you did, what is left, who is waiting.
3. Check **Owner replied** and your queue tiles once more.
4. Tell your manager about anything stuck, old or unclear. The panel has no handover button, so say it in a note or message.
5. Do not say "all clear" if a tile or the bell was dark. Say it could not be counted.

## Never do

- Never treat a failed or dark count as zero.
- Never skip the desks that have no tile.
- Never share your password or recovery codes to cover a shift. Ask your manager for access.
- Never leave customer details in notes. Write only what the next person needs.

## Related

- [Staff desks](/help/a/staff-desks)
- [Verification and SLA](/help/a/verification-sla)
- [Ticket escalation](/help/a/ticket-escalation)
- [Identity review](/help/a/identity-review)
- [Reports and takedowns](/help/a/reports-and-takedowns)
