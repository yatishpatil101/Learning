---
title: Verification SLAs
slug: verification-sla
category: ops-playbook
audience: staff
access: staff
order: 1
updated: 2026-07-31
summary: Internal turnaround targets for owner KYC and listing review, and the escalation path when they slip.
tags: [ops, sla, verification, internal]
---

> [!IMPORTANT]
> Internal runbook. Visible to PuneNest staff only. Do not paste extracts into consumer-facing replies.

## Turnaround targets

| Queue | Target | Hard limit |
| --- | --- | --- |
| Owner KYC — standard | 4 working hours | 24 hours |
| Owner KYC — priority plan | 1 working hour | 4 hours |
| New listing review | 4 working hours | 24 hours |
| Ownership document review | 1 working day | 3 working days |
| Re-review after owner correction | 2 working hours | 8 hours |
| Fraud-flagged listing | **Immediate hide**, review within 2 hours | 4 hours |

Measured from queue entry to decision, excluding time waiting on the owner.

## Decision rules

### Approve

Identity matches, address resolves to a known society or a verifiable building, photos pass duplicate detection, price within 2.5σ of the locality-configuration band, mandatory fields complete.

### Request correction

Any single fixable defect. Send the specific field, not a generic rejection. Owners who receive a specific message correct and resubmit at roughly three times the rate of those who receive a generic one.

### Reject

Identity mismatch, duplicate account, reused photos from a live listing elsewhere, address that cannot be resolved, or any advance-payment solicitation in the description.

### Escalate

Suspected organised fraud, a listing referenced in an active police complaint, media or legal contact, or anything involving a minor.

## Escalation path

1. **Reviewer** → 2. **Ops lead** (same day) → 3. **Trust & Safety** (same day for fraud) → 4. **Legal** (within 24 hours where a complaint exists)

Log every escalation in the ticket with the reason code. Do not escalate over chat without a ticket.

## Breach handling

If a queue is projected to breach its hard limit:

- Notify the ops lead before the breach, not after
- Priority-plan and fraud queues are drained first
- Record the cause code — volume, staffing, tooling, or dependency

## Related

- [Ticket handling and escalation](/help/a/ticket-escalation)
