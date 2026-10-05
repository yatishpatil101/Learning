---
title: Referral fraud review
slug: referral-fraud
category: ops-playbook
audience: staff
access: staff
order: 13
updated: 2026-10-04
summary: How staff review referral rewards, high-risk signals, approvals, rejections, and clawbacks.
tags: [ops, referrals, fraud, rewards, internal]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Desk and access

Use **Referral Verification** at `/ops/referrals`. The route is for `staff` and `admin`.

The desk reviews referral reward rows. It does not show raw evidence or unmasked mobiles; work from server-computed signals and the decision buttons.

## Queue tabs and counts

The desk loads the newest 100 rows. If more exist, the banner says the counts describe only those rows.

| Tab | What it shows |
| --- | --- |
| **Pending** | `pending` and `qualified` referrals |
| **High risk** | Any referral with `risk = high` |
| **Rewarded** | `rewarded` referrals |
| **All** | Every loaded status |

The stat tiles count **Pending**, **High risk**, **Rewarded**, and **Refused** where refused means `rejected` or `clawed-back`.

## Status states

| Status | Meaning | Available actions |
| --- | --- | --- |
| `pending` | Redeemed and waiting for review or qualification | Approve when eligible, or Reject |
| `qualified` | Referee's first listing passed ownership verification | Approve, or Reject |
| `rewarded` | Checker released the reward | Clawback |
| `rejected` | Checker refused before reward release | None |
| `clawed-back` | Reward was released and reversed | None |

Keep `rejected` and `clawed-back` separate. One means never paid; the other means paid and recovered.

## Background checks

| Signal | Green means | Red means |
| --- | --- | --- |
| **Identity verified** | Referred user holds the identity badge | Approval is blocked |
| **Identity unique** | Identity uniqueness check passed | Approval is blocked |
| **Activated** | Referral qualification activity exists | Review context only |
| **Same device** | No device match with referrer | Shared device risk |
| **Same IP** | No IP match with referrer | Shared network risk |
| **High velocity** | Referrer is under the daily velocity threshold | Farming risk |

High risk is computed from velocity and correlation signals; it is not a status.

## Reward rules

The reward label is server-composed, for example **+15 owner contacts**. `rewardAmount` counts owner contacts, not rupees.

A `qualified` referral already grants owner-contact entitlement from the qualifying event. A checker approval moves it to `rewarded` without changing the unit. A clawback removes the derived entitlement because only `qualified` and `rewarded` grant contacts.

## Decision procedure

1. Open the **Pending** tab first.
2. Check the background chips before acting.
3. Use **Approve** only when the row is `pending` or `qualified` and both identity checks are green.
4. Use **Reject** for `pending` or `qualified` rows that should never release.
5. Use **Clawback** only on `rewarded` rows when a released reward must be reversed.
6. Export CSV only for investigation; keep it internal.

The server re-checks identity at approval time. If the referred party no longer holds the identity badge, approval is refused even when the old row chip looked eligible.

## Holds and review triggers

Referral qualification can leave a row `pending` for human review when the referrer exceeds the rolling 30-day qualification cap. The cap window is 30 days and the default cap is ten qualifications.

Self-referrals, duplicate redeemed mobiles, unknown codes, and already-used referral codes are refused at redemption and do not become desk rows.

## What never to do

- Never approve when **Identity verified** or **Identity unique** is red
- Never treat **High risk** as a terminal status
- Never format `rewardAmount` as money
- Never reject a paid reward when the correct action is **Clawback**
- Never export referral CSV outside the fraud investigation
- Never promise a reward release outside the in-app referral status

## Related

- [Identity review](/help/a/identity-review)
- [Ownership and badges](/help/a/ownership-and-badges)
