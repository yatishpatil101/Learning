---
title: Settings and integrations
slug: settings-and-integrations
category: ops-playbook
audience: staff
access: staff
order: 29
updated: 2026-10-10
summary: How admins change site settings, fees, maps and flags safely, and how to read provider status and the call log.
tags: [ops, internal, settings, integrations, flags, fees]
modules: [settings, integrations]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Integrations**: the **Failed** count in **Last 24h** on the **Email**, **WhatsApp** and **Payments** cards.
- **Last failure** and its detail on each card. Compare it with **Last success**.
- **Settings → Feature flags**: **Maintenance mode** is off, and nothing else was switched without a reason.
- After any change by a colleague: the site behaves the way they said it would.

**Work on**

- Open the **Failed** filter in the call log and look for repeats on the same operation.
- For one customer's problem, search the call log by their full email, mobile or order id.
- Make planned changes in **Settings** in the order given under "Steps: change a setting".
- Weekly: read **Fees** and **Move-in Pack** prices against the approved price list.

## Desk and access

Both pages are admin only and are not available under `/staff`.

| Page | Route | Permission | Mode |
| --- | --- | --- | --- |
| **Settings** | `/admin/settings` | `settings:read` to view, `settings:write` to save | Read and write |
| **Integrations** | `/admin/integrations` | `settings:read` | Read-only |

A viewer without `settings:write` can open **Settings** but cannot save. The system does not ask for approval from a second admin. Changes save straight away, so follow the team habit below.

## Settings tabs

| Tab | What you can change | Button |
| --- | --- | --- |
| **General** | Site name, Legal name, Tagline, Support email, Support phone, WhatsApp, Support hours, Address, GST number | **Save details** |
| **General** | **Max photos per listing** (3 to 20) | **Save photo limit** |
| **General** | **Max flatmate groups per person** (1 to 10) | **Save group limit** |
| **Fees** | Plan prices, rent agreement fee, GST percent, free contact limit and referral numbers | **Save fees** |
| **Fees** | **Move-in Pack**: a **Live** / **Coming soon** switch and six service prices | **Save Move-in Pack** |
| **Maps** | **Restrict Places to the selected city**; per-city live switch, centre and bounds; blacklist | **Save** (with the city name) **coverage**, **Reset to default**, **Add** |
| **Feature flags** | **Application** and **Admin Modules** switches | Each switch asks you to confirm |

**Fees notes.** The four price fields must be whole numbers from 1 to 100000, or nothing is saved. Count fields such as the free contact limit show no ₹ sign. A blank field is refused with a message instead of being saved as 0. Subscribers already charged keep the amount they paid; **Finance** lists them by charged price.

**Maps notes.** Turning a city live or coming soon changes whether people can use it. The blacklist hides places by exact place match, or any place containing a word you type. You can add a reason. The bin icon removes an entry.

**Flags.** Each switch asks you to confirm (**Enable** or **Disable**) and shows a toast. The ones to treat with care:

| Flag | Effect |
| --- | --- |
| **Plan purchases** (off) | Pauses new purchases. Active plans keep working |
| **Referral rewards** (off) | Hides referral routes. Earned bonuses still count |
| **Public signups** (off) | Closes new registration |
| **Staff login** (off) | Staff cannot sign in. Administrators always can |
| **Maintenance mode** (on) | Blocks all consumer access. Off by default. Turning it on asks for confirmation in red |
| **Admin Modules** | Hides a module for everyone. **Properties** and **Users** are **Core** and cannot be switched |

## Integrations page

Three cards: **Email** (Zoho ZeptoMail), **WhatsApp** (Meta Cloud API) and **Payments** (Cashfree). Each shows:

- A **Live** or **Mock** chip. It comes from the server setup, not from a live check. **Live** does not prove the provider is healthy.
- **Last 24h** and **Last 7 days** counts of ok and failed calls.
- **Last success**, **Last failure** and the failure detail.
- An **Open** link (for example **Open Cashfree**) to the provider's own console.

The call log keeps 90 days. It has the search box "Full email, mobile or order id" (people are stored masked, so use the full value), **Provider** chips, **Outcome** chips (**All**, **Failed**, **OK**, **Not sent**) and 20 rows per page. Operations are Email, Login OTP, KYC decision, Payment order, Refund and Payment webhook. **Not sent** means the call was skipped, for example in **Mock**.

## Steps: change a setting

1. Write down the current value, and what you are changing it to and why.
2. Ask another admin to check it before you save. The system does not require this, so do it as a team habit for **Fees**, **Maintenance mode**, **Public signups**, **Staff login**, **Plan purchases** and city live switches.
3. Save it. Then reload the page and confirm the new value shows.
4. Verify the effect as a customer. For a fee, open the plan page. For a flag, check that the feature appears or hides. For a city, search that city.
5. Tell the team what changed and when.

Small fixes to **General** text are low risk. Changes to prices, flags and cities affect customers at once.

## Steps: investigate a failure

1. Open **Integrations**, choose the provider chip, then **Failed**.
2. Read the detail and note the operation, time and order id.
3. Check the provider's console with its **Open** link and compare.
4. For repeated failures, tell an admin with the operation and times. Do not change flags to work around it.

## Never do

- Do not turn on **Maintenance mode** during working hours without telling everyone first.
- Do not change a price while a customer is mid-payment.
- Do not ignore **Someone else changed these settings — reload to see their changes.** Reload the page, check the current values, then make your change again.
- Do not trust **Live** as proof. Read the call log.
- Do not paste customer details into notes or the blacklist reason.

## Related

- [Finance desk](/help/a/finance-desk)
- [Erasure requests](/help/a/erasure-requests)
- [Staff desks](/help/a/staff-desks)
- [Analytics review](/help/a/analytics-review)
