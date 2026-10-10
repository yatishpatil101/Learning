---
title: Referral fraud review
slug: referral-fraud
category: ops-playbook
audience: staff
access: staff
order: 13
updated: 2026-10-10
summary: How staff review referral rewards, high-risk signals, approvals, rejections, and clawbacks.
tags: [ops, referrals, fraud, rewards, internal]
modules: [referrals]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Pending** tab count, then **High risk** tab count.
- Signal chips: **Same device**, **Same IP**, and **High velocity** (referrer redeemed 5 or more in 24 h).
- Red **Identity verified** or **Identity unique** ? approval is blocked.
- A referrer at the 30-day qualification cap (ten by default) stays **Pending** for a person to review.

**Work on**

- Work **Pending** first: check the chips, then **Approve** or **Reject**.
- Then open **High risk** and look for repeat devices, networks or fast redemptions.
- Use **Clawback** only on a **Rewarded** row where the released reward must be reversed.

## Desk and access

Use **Referrals** in the sidebar (`/admin/referrals`; staff open it under `/staff/referrals`). You need the **Referrals** function (`referrals:read` to view, `referrals:write` to decide).

The desk reviews referral reward rows. It shows both mobiles in full but no raw device or IP evidence; work from the server-computed signals and the decision buttons.

## Queue tabs and counts

Rows are paged 20 at a time, with server-side counts on each tab and a search box (referrer, referred or id).

| Tab | What it shows |
| --- | --- |
| **Pending** | `pending` and `qualified` referrals |
| **High risk** | Any referral with `risk = high` |
| **Rewarded** | `rewarded` referrals |
| **Refused** | `rejected` or `clawed-back` referrals |
| **All** | Every status |

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
6. Export CSV (current page) only for investigation; keep it internal.

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
