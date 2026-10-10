---
title: Enquiries desk
slug: enquiries-desk
category: ops-playbook
audience: staff
access: staff
order: 21
updated: 2026-10-10
summary: How to read the Enquiries and Deals board - enquiries, visits, deals and the funnel - and what staff can and cannot do there.
tags: [ops, internal, enquiries, visits, deals, funnel]
modules: [enquiries]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Awaiting owner** enquiries that stay pending for days. The owner has not answered.
- **Scheduled** visits with no later **Confirmed** or **Completed**.
- **No show** and **Cancelled** visits that repeat for one listing or one owner.
- **Active** and **Reserved** deals that do not move.
- The **Funnel** tab for a locality with many enquiries and few visits.

**Work on**

- Old **Awaiting owner** enquiries: tell your manager or support, so someone can reach the owner.
- Check a customer's enquiry or visit when they contact support.
- Write a listing note when you have responded to an enquiry (see below).
- Report patterns to your manager: a stuck owner, a listing that gets no visits.
- This desk has no Dashboard tile. Open it yourself.

## Desk and access

- Route: `/admin/enquiries`. Staff open `/staff/enquiries`. Page title: **Enquiries & Deals**.
- Permission: `enquiries:read` (the **Enquiries** function). Managers and admins can read it too.
- The board is **read-only**. You cannot approve, decline, confirm or close anything here. Those decisions belong to the owner and the customer.
- The **Responded** button writes a listing note. The **Enquiries** function includes the note permission it needs.

## What is on the page

Four tabs: **Enquiries**, **Visits**, **Deals**, **Funnel**. Lists show 10 rows per page.

| Tab | Status chips |
|---|---|
| Enquiries | **All**, **Awaiting owner**, **Approved**, **Declined** |
| Visits | **All**, **Scheduled**, **Confirmed**, **Completed**, **Cancelled**, **No show** |
| Deals | **All**, **Active**, **Reserved**, **Closed**, plus a Type chip: **All**, **Rent**, **Buy** |

- Date chips on every tab: **All**, **Today**, **7d**, **30d**. **Clear filters** appears when one is set.
- Search ("Listing, customer or mobile"): part of a listing title or customer name works. A mobile number must be the whole number.
- Mobile numbers in lists are masked.
- **View** (eye icon) opens the detail with the full mobile number. Each time you open it, the system records that you looked.
- **Export CSV** (not on Funnel) exports the first 100 matching rows, with masked numbers.
- The Deals tab shows total GMV (deal value) across all deals.

### Funnel tab

| Card | Meaning |
|---|---|
| Total Enquiries | Contact requests (enquiries) in the period |
| Site Visits | Visits, and the percent of enquiries |
| Deals Closed | Closed deals, and the percent of visits |
| Deal GMV | Value of closed deals, and the overall conversion |
| Revenue per Enquiry | Deal GMV divided by enquiries. It is deal value, not Draazy income. |

- **Breakdown by Locality** shows the top 10 localities with enquiries, visits, deals and GMV.
- Filter: Date.

## Answer a customer who asks "what happened to my enquiry?"

1. Open **Enquiries** and search by the customer name or the full mobile number.
2. Read the status. **Awaiting owner** means the owner has not decided. **Approved** or **Declined** is the owner's decision.
3. If the owner has gone quiet, check **Visits** for the same customer to see if a visit exists.
4. Open **View** only if you must see the full mobile number. It is recorded.
5. Tell the customer the status in plain words. Do not promise an owner reply time.

## Log that you responded

1. On an **Awaiting owner** enquiry, click **Responded**.
2. The system adds the listing note "Responded to enquiry from <customer>." and shows "Note added to the listing".
3. If you get an error, tell your manager. You may be missing the Enquiries function.

## Never do

- Never read out or message a full customer mobile number unless the job needs it.
- Never export CSV just to browse. Delete the file when finished.
- Never tell a customer an enquiry is approved before the owner has approved it.
- Never treat a failed load as "no enquiries". It is unknown.

## Related

- [Verification and SLA](/help/a/verification-sla)
- [Ticket escalation](/help/a/ticket-escalation)
- [Staff desks](/help/a/staff-desks)
