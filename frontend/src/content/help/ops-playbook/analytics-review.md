---
title: Analytics review
slug: analytics-review
category: ops-playbook
audience: staff
access: staff
order: 26
updated: 2026-10-10
summary: What each Analytics tab measures, what to check daily and weekly, and which changes to report.
tags: [ops, internal, analytics, sla, demand]
modules: [analytics]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **SLA** tab: **Overdue right now** should be 0. **Longest Waiting Listings** shows the 10 oldest pending listings.
- **SLA** tab: **Unassigned** under **Ticket Pickup** and **In flight** under **Service Delivery**. Read the line under each box for how many are past target.
- **Funnel** tab: the rose "of previous" figure and the **Biggest drop** line. Note which stage it is.
- **Traffic** tab: the **Sessions & page views** line. Look for a sudden fall or spike, not small day-to-day changes.
- Any red **This report could not be loaded** notice. That is a failed read, not a quiet week. Reload before you report numbers.

**Work on**

- Open overdue listings from **Longest Waiting Listings** (each title opens it in Properties). Verification work follows [Verification SLAs](/help/a/verification-sla).
- Tell the right desk about unassigned tickets that are past target: see [Ticket handling and escalation](/help/a/ticket-escalation).
- Weekly: read **Supply Gap**, **Funnel** and **Pricing** and send your manager a short note with what changed and which locality or stage it concerns.
- Weekly: check **City Expansion Requests** and **Demand Alerts by Locality** and pass the top names to your manager.

## Desk and access

Use **Analytics** at `/admin/analytics` (staff open it under `/staff/analytics`). You need `analytics:read`. Staff get it through the **Analytics** function; managers and admins have it by default. The page is read-only: the only action is **Export traffic CSV** on the **Traffic** tab.

An admin can switch the whole module off in **Settings → Feature flags → Admin Modules**. The **Report window** menu (Last 30, 90 or 180 days; default 90) shows on every tab except **Pricing**. A **Product analytics** link appears only when it is configured for this site.

## What each tab shows

| Tab | What it measures | Read it as |
| --- | --- | --- |
| **Traffic** | Sessions and page views by day; **Traffic sources** and **Device split** (both count sessions); **Anonymous vs signed-in** per week | Volume and mix of visitors. There is no new-vs-returning view |
| **Traffic** (lower half) | **Anonymous share**, **Session → Signup rate**, **Anonymous sessions**, **Signups in period**; **Where visitors leave**; **Pages visited by anonymous users** | A dash means the base figure was missing, not zero. Exit percentages are a share of the exits shown, not of all exits |
| **Engagement** | **Avg. session duration** (minutes) and **Bounce rate** (single-view sessions) per week; **Top pages by views** | A week with no sessions has a gap in the line, not a zero |
| **Funnel** | **Listings posted**, **Approved**, **Contact requests**, **Visits booked**, **Deals closed** | Each stage counts what happened that week. It does not follow one group of people through |
| **Supply Gap** | Demand against listings by locality | See the table below |
| **Pricing** | Asking ₹/sqft, rent and rental yield by locality | A live snapshot of approved flats. A locality needs 3 or more to show a figure |
| **SLA** | Listing review turnaround, ticket pickup and delivery, concierge listings | See the table below |

## Supply Gap

| Item | Meaning |
| --- | --- |
| Demand | Each alert counts 5 and each search counts 2 |
| Per listing | Weighted demand divided by (listings + 1). The list is sorted highest first |
| **Hot demand users** | People who searched the same locality 3 or more times in the window |
| **Priority** | **High** at 5 or more per listing, or 2 or more hot users. **Medium** at 1 or more. **OK** below that |
| **No locality given** | Searches with no place. It has no priority because there is nowhere to source supply |
| **City Expansion Requests** | People who asked to be told when Draazy launches in a new city. Counts only, no contact details. Use **Try again** if it fails |

## SLA targets

| Track | Target the server compares against |
| --- | --- |
| Listing approval | 24 hours |
| Ticket pickup (first assignment) | 4 hours |
| Service delivery (raised to finished) | 3 days |
| Concierge to live (staff-posted listing) | 7 days |

The **Within target** figure is green at 90% or higher and amber below. Grey means nothing was measured. If turnaround is "not recorded", decisions exist without timestamps and only the backlog numbers are real.

## Weekly review

1. Set **Report window** to Last 30 days. Open **Funnel** and write down the **Biggest drop** stage.
2. Open **Supply Gap**. Note every **High** locality and the top locality in **Demand Alerts by Locality**.
3. Open **Pricing**. Look for a locality whose asking rate or yield looks out of line with its neighbours, then check the listings behind it in Properties.
4. Open **SLA**. Note any track that is amber, and the count past target.
5. Send your manager one message: what changed, where, and what you checked.

## What a worrying change looks like

- **Overdue right now** above 0 (a listing waiting past 24 hours), or **Within target** under 90%.
- Tickets past pickup or delivery target that keep growing.
- Sessions or signups dropping sharply with no known cause. Also a report that stays red after a reload.
- One funnel stage collapsing, for example approvals far below postings.
- A single asking rate or yield that looks wrong for a locality. It may be one bad listing.

Tell your manager. For a stuck page or numbers that look wrong, include the tab, the window and a screenshot.

## Never do

- Do not read a zero, dash or empty chart as proof. Check for the red notice first.
- Do not quote figures from a different **Report window** side by side.
- Do not share exported CSVs outside Draazy.
- Do not treat **Supply Gap** priorities as a promise to sellers. They are a guide for where to source listings.

## Related

- [Verification SLAs](/help/a/verification-sla)
- [Ticket handling and escalation](/help/a/ticket-escalation)
- [Team activity review](/help/a/team-activity)
- [Staff desks](/help/a/staff-desks)
