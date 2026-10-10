---
title: Finance desk
slug: finance-desk
category: ops-playbook
audience: staff
access: staff
order: 28
updated: 2026-10-10
summary: How to read the Finance page, what it does not measure, and how to check it against the payment provider.
tags: [ops, internal, finance, revenue, payments]
modules: [finance]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Overview**: the **Not every figure below is measured** banner. Read it every time before you quote a number.
- **Revenue this month** and its change against last month.
- **MRR** (monthly recurring revenue) and the **Subscriptions** list.
- **Transactions** tab, **Pending** chip: payments that started but are not confirmed.
- Any gap between what **Finance** shows and what customers tell Support they paid.

**Work on**

- Weekly: compare the **Paid** total on **Transactions** with the payment provider console. See "Steps: weekly reconciliation".
- Follow up with Support on payments that stay **Pending**. Check **Integrations** for the matching payment call first.
- Download **Revenue CSV** at month end for the finance record and check it against the **Revenue by month** chart.
- Report any figure that looks wrong to an admin with the tab, window and a screenshot.

## Desk and access

Use **Finance** at `/admin/finance`. It is admin only and staff do not see it under `/staff`. It needs `finance:read`. The page is read-only: you can look and download CSV files, not edit or refund anything.

An admin can switch the module off in **Settings → Feature flags → Admin Modules**.

## What is on the page

| Tab / control | What it shows |
| --- | --- |
| **Revenue CSV** (top right) | Downloads `draazy-revenue.csv` with Month, Subscriptions, Services and Total for the last 24 months |
| **Overview** | Six tiles, four charts and the **Net position** card |
| **Transactions** | The ledger of payments, with search, status chips and **Export CSV** |

**Overview tiles**

| Tile | Meaning |
| --- | --- |
| **MRR** | Active, paid subscriptions, with quarterly plans divided by 3 and yearly by 12 |
| **Revenue this month** | Money booked this month, with the change against last month |
| **Services revenue** | Always shows a quoted value note. See "What is not measured" |
| **Revenue (12 mo)** | Last 12 months of booked revenue |
| **ARPU** | This month's revenue divided by all accounts |
| **ARPPU** | This month's revenue divided by users who paid this month |

**Charts.** **Revenue by month** has a window of 6, 12 or 24 months. **Revenue mix** is this month only. **MRR growth** compares booked subscription revenue each month with the **MRR** tile, so the two can differ. **Subscriptions** groups paying plans by the price actually charged.

**Transactions.** Search with **Search party…**. The chips are **All**, **Paid** and **Pending**. Each page has 20 rows, taken from the newest 100 loaded. The note "Showing the newest N of M" tells you when older ones are not in view. **Export CSV** downloads every row that matches your filters as `draazy-transactions.csv`, with the columns ID, Date, Party, Type, Platform take and Status. The eye icon opens the detail for one row.

## What is not measured

The banner lists what the page cannot count:

- **Refunds.** **Net position** shows **Gross revenue**, **Refunds** and **Net retained**, but refunds are marked **Not measured**. The figure stays at ₹0 and does not include service-request refunds. Net retained equals gross for now.
- **Services.** Revenue leaves out the services marketplace. A service order records a quote, not money received. So **Services revenue** is a quoted value and not income.

Each one turns on only when engineering enables it in the server setup. Do not tell anyone a number includes them until the banner for that item is gone.

How the numbers are built: a payment counts as revenue when a subscription has a payment reference and is not pending. It is dated by the day it started, in Indian time. The ledger only shows subscriptions today, and its only statuses are **Paid** and **Pending**. Check failed payments in **Integrations** instead (see [Settings and integrations](/help/a/settings-and-integrations)).

There are no invoices, payouts or reconciliation tools on this page.

## Steps: weekly reconciliation

1. On **Transactions**, choose **Paid** and note the count and amount for the week.
2. Open **Integrations**, then **Open Cashfree** on the **Payments** card, and find the same dates in the provider console.
3. Compare the counts and amounts. Search a **Party** in **Finance** if one is missing.
4. For a mismatch, look in the **Integrations** call log for **Payment order** and **Payment webhook** with the order id.
5. If the money is in the provider console but not in **Finance**, report it to an admin with the order id. Do not edit anything yourself.

## Steps: answer a customer who says they paid

1. Search the person in **Transactions** and read the **Status**.
2. **Paid** means we received it. **Pending** means we did not confirm it.
3. For **Pending**, check the call log with the order id. Raise it with an admin if the provider console shows it as paid.

## Never do

- Do not quote **Revenue** as net of refunds or including services.
- Do not share the CSV files outside Draazy.
- Do not promise a customer a refund. **Finance** cannot issue one.
- Do not treat an empty ledger or an endless loading state as zero revenue. Reload, then report it.

## Related

- [Settings and integrations](/help/a/settings-and-integrations)
- [Analytics review](/help/a/analytics-review)
- [Drafting desk](/help/a/drafting-desk)
- [Referral fraud](/help/a/referral-fraud)
