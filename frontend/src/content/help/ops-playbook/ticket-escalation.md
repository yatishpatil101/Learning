---
title: Ticket handling and escalation
slug: ticket-escalation
category: ops-playbook
audience: staff
access: staff
order: 2
updated: 2026-09-22
summary: Priority definitions, first-response targets, and the escalation ladder for support tickets.
tags: [ops, support, tickets, escalation, internal]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Priority definitions

| Priority | Definition | First response | Resolution |
| --- | --- | --- | --- |
| P0 | Money lost, fraud in progress, safety risk | 30 minutes | 4 hours |
| P1 | Payment failed, account locked, listing wrongly removed | 2 hours | 24 hours |
| P2 | Feature not working, verification stuck | 8 hours | 3 working days |
| P3 | How-to question, feedback, feature request | 24 hours | 5 working days |

P0–P3 are ours; the ticket itself stores `urgent`, `high`, `normal` and `low` in that order, and the field is set by the **customer**, not by us. Re-set it to match the impact you assess as soon as you pick the ticket up — the queue sorts on the stored value, so a P0 left at `normal` is a P0 nobody is looking at.

Set priority from the **impact**, not from the tone of the message. An angry P3 is still a P3; a calm report of a lost deposit is a P0.

## Statuses

`new` → `open` (*In progress*) → `waiting` (*Awaiting your reply*) → `resolved` → `closed`. A customer reply re-opens a ticket from `resolved`, `closed` or `waiting`, so a case you closed can come back — check your own queue before assuming a silent ticket is done. Park a ticket in `waiting` only when the next action is genuinely theirs; the clock keeps running while it sits in `open`.

## Handling order

1. **Read the whole thread** before replying. Repeating a question the user already answered is the top driver of CSAT loss.
2. **Check the account** — invoices, listings, prior tickets. Most context is already there.
3. **State what you will do and by when.** "Looking into it" without a time is not a response.
4. **Close with the outcome**, not with "resolved".

## Auto-escalate to P0

- Any report of money paid to someone claiming to represent Draazy
- Any allegation of physical threat or harassment involving a visit
- A payment charged with no invoice record
- Any contact from law enforcement or a regulator

P0 goes to the ops lead **by phone**, not by ticket assignment.

## Escalation ladder

1. **Agent** → 2. **Support lead** → 3. **Ops lead** → 4. **Trust & Safety** (fraud/safety) or **Finance** (money) → 5. **Legal**

Every hop must add a note explaining *why* it was escalated. A reassignment without a reason gets bounced back.

## Refunds

Agents may approve refunds up to **₹2,000** without escalation where the [Refund Policy](/refund-policy) clearly applies. Above that, or in any ambiguous case, escalate to Finance. Never promise a refund you have not confirmed is approvable.

## What never to do

- Never share another user's contact details, even to "connect" two parties
- Never confirm or deny whether a specific person has an account
- Never quote internal SLA figures to a consumer
- Never take a case to WhatsApp; keep it in the ticket

## Related

- [Verification SLAs](/help/a/verification-sla)
