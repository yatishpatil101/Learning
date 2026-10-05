---
title: Verification SLAs
slug: verification-sla
category: ops-playbook
audience: staff
access: staff
order: 1
updated: 2026-10-04
summary: Internal queue rules for listing verification, live re-checks, duplicates and owner follow-up.
tags: [ops, sla, verification, internal]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Desk and access

Use **Admin → Properties** (`/admin/properties`) for listing verification. It is an admin-portal desk: you need a back-office account holding `properties:read` to see it, `properties:verify` to decide verification cases, and `properties:moderate` to edit, flag, archive, restore, or merge duplicate listings.

Use the owner follow-up buttons only if your role includes `postOnBehalf:write`; those routes can prepare claim-link and WhatsApp outreach to an owner.

## Queue tabs and targets

| Tab | What enters | Target shown in the desk |
| --- | --- | --- |
| **To verify** | Pending listings ready for staff review | Warn at 24 hours; breach at 48 hours |
| **Re-checks** | Live listings with a `recheckRequestedAt` timestamp | Warn at 24 hours; breach at 72 hours |
| **Badge requests** | Listings asking for ownership verification | Warn at 24 hours; breach at 72 hours |
| **Follow-up** | Staff-posted or live listings waiting on owner confirmation | No breach colour; the row is a follow-up task |
| **Flagged** | Listings with a staff flag | Work by risk, not by SLA colour |
| **Duplicates** | Server-built duplicate clusters | Decide each cluster before approving any member |
| **All listings** | Full moderation view, including archived rows when filtered | Use only to find or restore a known listing |

The SLA panel is green at 90% or better, amber from 75% to 89%, and rose below 75%.

## Listing states

| State | Staff meaning | Buyer-visible effect |
| --- | --- | --- |
| `pending` | Waiting, in review, or awaiting owner info | Hidden from public search |
| `approved` | Published | Visible unless archived |
| `needs_info` review | Staff asked for a correction | Listing stays `pending`; owner sees the reason |
| `rejected` | Final refusal | Hidden; reopen needs second reviewer override |
| `flagged` | Unsafe or disputed | Hidden until the flag is cleared or archived |
| `archived` | Soft-deleted | Hidden; restore returns to `pending` |

## Review procedure

1. Open the listing from **To verify** or **Re-checks**.
2. Check the photos, duplicate result, details, address and locality.
3. Tick every checklist item before approving. The **Approve** button stays locked until the checklist is complete, and the server rejects incomplete approvals.
4. Read fraud signals before deciding. Hard signals require the second-approver path; do not approve directly.
5. Add an internal note when the decision depends on evidence not visible in the fields.
6. Decide with **Approve**, **Needs info**, or **Reject**.

## Decision rules

### Approve listing

Use **Approve** only when the checklist is complete, no unresolved duplicate exists, the address and locality are believable, and any hard-signal override has a different second reviewer.

### Send needs info

Use **Needs info** for fixable gaps. Choose a reason code. If the code is **other**, write the note. Owner reply or edit resubmits the listing and clears the waiting flag.

The hourly sweep sends owner reminders after 3 days and 7 days. If there is no reply or edit after 14 days, the listing is soft-archived with `needs_info_timeout`.

### Reject listing

Use **Reject** for non-fixable or unsafe listings. A reason code is required. A rejected listing does not reopen just because the owner replies; use the second-reviewer override when a rejected case must re-enter review.

### Work re-checks while live

Use **Approve edits** or the re-check pass action when the live listing still matches policy. Use **Reject listing** from the re-check modal when the live listing must come down; rejecting removes it from public search.

### Resolve duplicate clusters

Use **Keep this, archive the rest** only when the cluster really points to the same property. Use **Not a duplicate** for false positives. Treat a duplicate-scan failure or truncation as unknown, not clean.

## Never do in listing verification

- Do not approve with an unticked checklist.
- Do not approve a hard-signal case through your own override.
- Do not use **Reject** for a fixable photo, address or document gap.
- Do not publish a staff-posted listing before the owner confirms it.
- Do not treat **Follow-up** as a breach queue; send the owner nudge and record the outreach.

## Escalation path

Escalate suspected organised fraud, legal or police references, minors, media contact, or repeated override attempts through the ticket ladder. Record the listing id, reason code, signals and action already taken.

## Related

- [Ticket handling and escalation](/help/a/ticket-escalation)
- [Ownership and badges](/help/a/ownership-and-badges)
- [Reports and takedowns](/help/a/reports-and-takedowns)
