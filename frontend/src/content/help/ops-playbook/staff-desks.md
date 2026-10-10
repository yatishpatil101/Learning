---
title: Staff desks at a glance
slug: staff-desks
category: ops-playbook
audience: staff
access: staff
order: 0
updated: 2026-10-10
summary: Which back-office desk handles which work, who can open it, and the runbook that governs it.
tags: [ops, desks, access, index, internal]
modules: [dashboard]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Waiting for you** tiles ? a number in amber means work is open on that desk.
- The **Oldest ?** line on each tile ? the tile with the oldest item goes first.
- **All clear** is the only empty state. If the dashboard says it could not load, reload; do not assume nothing is waiting.
- Managers and admins: **SLA health** shows work finished on time ? green at 90% or more, amber 75?89%, rose below 75%, plus a **late now** count.

**Work on**

- Open the tile with the oldest waiting item and follow its runbook from the table below.
- Managers and admins: clear the **Pending Verification**, **Needs Follow-up**, **Flagged Listings** and **Open Reports** tiles.
- No tile, or "No work is assigned to you yet"? Ask your manager to grant a function in **Team & Access**.

## One back office

Staff, managers and admins share one back office. Managers and admins open it at `/admin`; staff open the same pages under `/staff/…`. Old `/ops/…` bookmarks redirect to the matching `/admin/…` page.

What you see depends on the **functions** you hold (KYC review, Property verification, Listing moderation, Post on behalf, Flatmates, Support, Reports, Referrals, Societies, Content, Analytics, and one per service desk). A staff member with no function sees the dashboard only. Admins see everything; managers also see every service desk. If a desk you need is missing, ask your manager or an admin to grant the function in **Team & Access** (`/admin/team`, manager and admin only) — do not borrow a colleague's login. New staff activate from an invite link at `/staff-invite`.

## Desks

| Desk | Route | Work | Runbook |
| --- | --- | --- | --- |
| Support queue | `/admin/support` | Customer support conversations | [Ticket handling and escalation](/help/a/ticket-escalation) |
| Service tickets | each service desk's **Customer tickets** tab; Home Loans (`/admin/home-loans`) is the board | Service-request tickets | [Ticket handling and escalation](/help/a/ticket-escalation) |
| KYC review | `/admin/kyc-review` | ID + selfie identity checks | [Identity review](/help/a/identity-review) |
| Rent Agreement | `/admin/rent-agreement` | Rent-agreement drafting, registration, refunds | [Drafting desk and service queues](/help/a/drafting-desk) |
| Other service desks | `/admin/legal`, `/admin/interior`, `/admin/packers`, `/admin/valuation` | Legal, interior, packers and valuation requests | [Service queues](/help/a/service-queues) |
| Referrals | `/admin/referrals` | Referral reward review and clawbacks | [Referral fraud review](/help/a/referral-fraud) |
| Flatmates | `/admin/flatmates` | Flatmate posts, badges, edits and group applications | [Flatmate review](/help/a/flatmate-review) |
| Properties | `/admin/properties` | Listing verification, re-checks, duplicates | [Verification SLAs](/help/a/verification-sla) |
| Properties → ownership | `/admin/properties` | Ownership evidence and ownership badges | [Ownership and badges](/help/a/ownership-and-badges) |
| Users → Badge approvals | `/admin/users` | Hand-granted verified-badge requests (admin only) | [Ownership and badges](/help/a/ownership-and-badges) |
| Reports | `/admin/reports` | Listing, user and flatmate reports; review moderation | [Reports and takedowns](/help/a/reports-and-takedowns) |
| Societies | `/admin/societies` | Candidates, merges, directory | [Society moderation](/help/a/society-moderation) |
| Post on Behalf | `/admin/post-on-behalf` | Listings for owners who called or messaged | [Post on behalf](/help/a/post-on-behalf) |

## Rules for every desk

- Work the oldest item in the queue first unless a runbook says a risk queue goes first.
- Record why you decided, not just what — the next reviewer reads your note, not your mind.
- Never decide a case you raised, approved or claimed yourself where the runbook asks for a second person.
- Never move a case to WhatsApp, personal email or chat; keep it on the desk.
- When a desk fails to load, treat the queue as unknown, not empty, and escalate.
