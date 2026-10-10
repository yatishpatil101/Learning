---
title: Identity review
slug: identity-review
category: ops-playbook
audience: staff
access: staff
order: 3
updated: 2026-10-10
summary: Internal KYC desk procedure for reviewing captured ID documents, selfies, QA samples and revocations.
tags: [ops, kyc, identity, internal]
modules: [kycReview]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Needs review** tab, oldest first ? amber from 24 h ("due soon"), rose from 48 h ("overdue").
- **Overdue** button count ? pending cases past 48 h.
- **Claim ? Mine** chip ? you can hold at most 3 cases at once.
- **QA sample** tab count ? approvals waiting for a second reviewer.
- A pending case left for 14 days is rejected automatically, so keep the oldest moving.

**Work on**

- Clear **Overdue** cases first, then work **Needs review** oldest first.
- Finish a case you open: opening it holds it for you for 30 minutes.
- Do **QA sample** cases that someone else approved: **Confirm** or **Revoke**.
- Decide each case from the evidence in it; never your own case.

## Desk and access

Use **KYC review** at `/admin/kyc-review` (staff open it under `/staff/kyc-review`). It belongs to the **KYC review** function; the page needs `identity:write` (there is no view-only version), which covers viewing, claiming, approving, rejecting, QA and revoking.

The customer submits a camera-captured identity document image and selfie through the identity flow. Review only what the case shows; do not ask for documents outside the product flow.

## Queue tabs

| Tab | What it contains | Sort and page size |
| --- | --- | --- |
| **Needs review** | Pending identity submissions | Oldest first; 10 per page |
| **QA sample** | Approved cases selected for second check | Own approvals are excluded |
| **Decided** | Verified, rejected and revoked cases | Newest first; 10 per page |

Use filters for name or mobile, document type, claim owner, overdue state, outcome and sort.

## Targets and stale handling

| Item | Rule |
| --- | --- |
| Warning age | The UI marks old pending cases amber at 24 hours |
| Overdue filter | The backend counts pending cases as overdue at 48 hours |
| Claim hold | Opening a pending case claims it for 30 minutes |
| Active claims | A reviewer may hold 3 active identity cases |
| Stale pending sweep | Cases older than 14 days are rejected as `not_reviewed`; images are purged and the attempt window is reset |

**Force release** is admin-only. Use it only when another reviewer has clearly abandoned a claim; managers and staff ask an admin. The button asks for confirmation before clearing the hold. You cannot decide your own identity case.

## Approval checklist

Approve only after all of these are true:

1. Every visible checklist item is ticked.
2. The document number is present.
3. The holder name is present.
4. Either full date of birth or birth year is present; never both.
5. The holder is at least 18.
6. Birth year is between 1900 and the allowed adult cutoff.
7. The selfie and document holder match.
8. If a liveness challenge exists, **Confirm the requested pose** is ticked.

Use **Approve review** only when the button is enabled. Approval may still enter **QA sample** before the badge is fully trusted.

## Rejection rules

Use **Reject review** for cases that cannot pass from the submitted evidence. Pick one reason:

| Reason | Use when |
| --- | --- |
| `blurry` | Text or face cannot be read |
| `cropped` | Required document area is missing |
| `mismatch` | Selfie, name or number does not match |
| `expired` | Document is no longer valid |
| `not_holder` | Submitter is not the document holder |
| `unsupported` | Document type is outside the accepted set |
| `other` | The case is invalid for another visible reason |

Write a note of at least 10 characters for `mismatch`, `not_holder` and `other`.

## QA and revocation

QA samples are selected for liveness gaps, missing pose challenge, number override, resubmission or random sampling. A different reviewer must handle QA.

Use **Confirm** when the approval is sound. Use **Revoke** or **Revoke badge** only when the verified badge should be removed. Revocation needs a reason between 10 and 300 characters and is audited.

An identity-earned verified badge cannot be withdrawn from the user badge screen. Revoke it from the identity review record.

## Never do in identity review

- Do not approve your own QA sample.
- Do not QA a case you approved.
- Do not ask an admin to force-release an active colleague unless needed to keep the queue moving.
- Do not accept a typed document value that contradicts the captured image.
- Do not store copies of the captured document or selfie outside the case.

## Related

- [Ticket handling and escalation](/help/a/ticket-escalation)
- [Ownership and badges](/help/a/ownership-and-badges)
- [Referral fraud review](/help/a/referral-fraud)
