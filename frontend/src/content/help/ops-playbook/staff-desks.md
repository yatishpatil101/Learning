---
title: Staff desks at a glance
slug: staff-desks
category: ops-playbook
audience: staff
access: staff
order: 0
updated: 2026-10-04
summary: Which back-office desk handles which work, who can open it, and the runbook that governs it.
tags: [ops, desks, access, index, internal]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Two portals

| Portal | Opens for | Entry |
| --- | --- | --- |
| **Ops** | `staff` and `admin` accounts | `/ops` |
| **Admin** | `admin` accounts only | `/admin` |

Admin desks, and **KYC review** on the ops side, show only when your account holds the matching permission (for example `identity:read`). If a desk you need is missing, ask an administrator to grant it in **Team & Access** — do not borrow a colleague's login.

## Ops desks

| Desk | Route | Work | Runbook |
| --- | --- | --- | --- |
| Support queue | `/ops/support` | Customer support conversations | [Ticket handling and escalation](/help/a/ticket-escalation) |
| Requests | `/ops/requests` | Service-request tickets across teams | [Ticket handling and escalation](/help/a/ticket-escalation) |
| KYC review | `/ops/kyc-review` | ID + selfie identity checks | [Identity review](/help/a/identity-review) |
| Rent Agreement | `/admin/rent-agreement` | Rent-agreement drafting, registration, refunds | [Drafting desk and service queues](/help/a/drafting-desk) |
| Other service desks | `/admin/legal`, `/admin/interior`, `/admin/packers`, `/admin/valuation` | Legal, interior, packers and valuation requests | [Service queues](/help/a/service-queues) |
| Referrals | `/ops/referrals` | Referral reward review and clawbacks | [Referral fraud review](/help/a/referral-fraud) |
| Flatmate | `/ops/flatmate-review` | Flatmate posts, badges, edits and group applications | [Flatmate review](/help/a/flatmate-review) |

## Admin desks

| Desk | Route | Work | Runbook |
| --- | --- | --- | --- |
| Properties | `/admin/properties` | Listing verification, re-checks, duplicates | [Verification SLAs](/help/a/verification-sla) |
| Properties → ownership | `/admin/properties` | Ownership evidence and ownership badges | [Ownership and badges](/help/a/ownership-and-badges) |
| Users → Badge approvals | `/admin/users` | Manual verified-badge requests | [Ownership and badges](/help/a/ownership-and-badges) |
| Reports | `/admin/reports` | Listing, user and society-content reports; review moderation | [Reports and takedowns](/help/a/reports-and-takedowns) |
| Societies | `/admin/societies` | Claims, residents, candidates, moderation | [Society moderation](/help/a/society-moderation) |
| Post on Behalf | `/admin/post-on-behalf` | Listings for owners who called or messaged | [Post on behalf](/help/a/post-on-behalf) |
| Home Loans | `/admin/home-loans` | Home-loan ticket board; other desks show tickets under **Tickets** | [Ticket handling and escalation](/help/a/ticket-escalation) |

## Rules for every desk

- Work the oldest item in the queue first unless a runbook says a risk queue goes first.
- Record why you decided, not just what — the next reviewer reads your note, not your mind.
- Never decide a case you raised, approved or claimed yourself where the runbook asks for a second person.
- Never move a case to WhatsApp, personal email or chat; keep it on the desk.
- When a desk fails to load, treat the queue as unknown, not empty, and escalate.
