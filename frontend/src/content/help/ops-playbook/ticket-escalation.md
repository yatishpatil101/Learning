---
title: Ticket handling and escalation
slug: ticket-escalation
category: ops-playbook
audience: staff
access: staff
order: 2
updated: 2026-10-04
summary: How staff triage, answer, assign, and escalate support conversations and service-request tickets.
tags: [ops, support, tickets, escalation, internal]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Desk map

| Desk | Route | Backing table | Use it for |
| --- | --- | --- | --- |
| Support conversations | `/ops/support` | `support_tickets` | Customer support threads |
| Service-request tickets | `/ops/requests`, `/admin/services` | `tickets` | Ops work items with team, priority, assignee, and private notes |

Both ops routes are for `staff` and `admin`. `/admin/services` is admin-only and adds named staff assignment.

## Priority ladder

| Impact | Ticket priority | Definition | First response | Resolution target |
| --- | --- | --- | --- | --- |
| P0 | `urgent` | Money lost, fraud in progress, safety risk | 30 minutes | 4 hours |
| P1 | `high` | Payment failed, account locked, listing wrongly removed | 2 hours | 24 hours |
| P2 | `medium` | Feature not working, verification stuck | 8 hours | 3 working days |
| P3 | `low` | How-to question, feedback, feature request | 24 hours | 5 working days |

Set priority from impact, not tone. An angry P3 stays P3; a calm lost-money report is P0.

> [!NOTE]
> `/ops/support` has no priority or private-note field. Service-request tickets store `low`, `medium`, `high`, or `urgent`; current staff screens display and filter that value but do not provide a priority editor.

## Support conversation queue

Use **Support queue** at `/ops/support`. Work **Awaiting reply** first; **Answered** means not waiting on staff; **All** is the paged archive.

Opening a row loads the full thread and marks the staff side read when the row was awaiting reply.

| Status | Badge text | Staff action |
| --- | --- | --- |
| `open` | Open | Active case; reply or escalate |
| `in-progress` | In Progress | Work is underway |
| `waiting` | Waiting | Customer owes the next reply |
| `resolved` | Resolved | Outcome sent; monitor for reply |
| `closed` | Closed | Finished archive |

The support queue has no status, assignee, priority, or private-note controls. Answer in the thread. If a hand-off needs staff-only context, put it in the escalation message outside the customer thread.

Read states are separate from status:

| Field | Meaning |
| --- | --- |
| **Waiting on: Us** | A customer message is unread by staff |
| **Waiting on: Them — unopened** | Staff replied and the customer has not opened it |
| **—** | Neither side has an unread marker |

A customer reply sets **Waiting on: Us** again even if the case looked answered.

## Service-request ticket queue

Use **Service requests** at `/ops/requests` for the staff board. Use `/admin/services` when an admin needs the full services console, named assignment, CSV export, or `?open=<ticketId>` deep link.

| Field | Current behavior |
| --- | --- |
| Team | Staff are server-scoped to their own team; admins can see all teams |
| Priority | Stored on `tickets.priority`; create accepts it, but current consumer service forms do not send it, so most tickets default to `medium` |
| Assignee | `/ops/requests` self-claims only; `/admin/services` can assign to an active staff member on the ticket team |
| Notes | Private internal notes appended with **Add** / **Save**; customers never see them |
| Age | Non-terminal tickets show today, 2–4 day warning, or 5+ day breach |

### Service-ticket actions

| Button or control | Effect |
| --- | --- |
| **Claim** | Assigns the ticket to you; status stays `open` |
| **Start** | Admin console assigns first active team member if unassigned, then sets `in-progress` |
| **Resolve** | Sets `resolved` |
| **Open** | Opens the drawer/modal without mutating |
| **Status** select | Can set `open`, `in-progress`, `waiting`, `resolved`, or `closed` |
| **Activity / Add a note** | Appends one private note |

There is no transition table for service-request tickets; any legal status can be set from any other. Use `waiting` only when the next action is genuinely the customer's. Use `closed` for filed work where no resolution step is needed.

### Priority on service tickets

`TicketUpdate` accepts priority, and the backend validates `low`, `medium`, `high`, and `urgent`. The current `/ops/requests` and `/admin/services` UIs do not send priority updates. If stored priority is wrong, record the assessed P-level in a private note and escalate to the support lead or ops lead; for P0, phone the ops lead immediately.

### Drafting-desk relationship

Service-request tickets are triage and work-tracking rows. The service desk pages (`/admin/rent-agreement`, `/admin/legal`, and so on) own the live service-request workflow: documents, identity reveal, drafts, customer approval, refunds, registration, and cancellation. When a ticket points to a rent agreement or other service request, update the case on its service desk for workflow actions and keep the ticket note as the staff hand-off trail.

## Handling procedure

1. Identify which desk owns the row: support conversation or service-request ticket.
2. Read the full customer thread or ticket detail before replying or moving status.
3. Check the account, listing, invoice, service request, or verification case.
4. Send customer-facing text only in customer-visible threads or messages.
5. Use private notes only on service-request tickets, not on `/ops/support`.
6. If a queue fails to load, retry or escalate the outage; never treat an error as an empty queue.
7. Close with the outcome, not with "resolved".

## Auto-escalate to P0

Auto-escalate reports of money paid to someone claiming to represent Draazy, physical threat or harassment involving a visit, a payment charged with no invoice record, or contact from law enforcement or a regulator.

P0 goes to the ops lead **by phone**, not by ticket assignment alone.

## Escalation ladder

Agent → Support lead → Ops lead → Trust & Safety for fraud or safety, Finance for money → Legal.

Every hop must include the ticket id, assessed P-level, current stored priority when available, what you checked, what you told the customer, and why the next team owns it.

## Refund handling

The support queue cannot approve or process refunds. It can only collect the customer's request and keep the thread updated.

For rent-agreement refunds, send the case to the Rent Agreement desk: the refund widget requires the current holder to ask and a different colleague to approve before the gateway refund is sent. For other paid products, escalate to Finance with the transaction id and policy reason. Do not quote an internal cap or promise money back before Finance or the service desk confirms the path.

## What never to do

- Never share another user's contact details, even to connect two parties
- Never confirm or deny whether a specific person has an account
- Never quote internal SLA figures to a consumer
- Never take a case to WhatsApp; keep it in the ticket
- Never tell a customer the queue is empty when the screen says it could not load
- Never approve a refund from `/ops/support`
- Never put staff-only notes in a support conversation reply

## Related

- [Drafting desk and service queues](/help/a/drafting-desk)
- [Service queues](/help/a/service-queues)
- [Verification SLAs](/help/a/verification-sla)
- [Identity review](/help/a/identity-review)
