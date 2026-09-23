---
title: Listing freshness and why listings expire
slug: listing-freshness
category: listing
audience: owner
order: 4
updated: 2026-09-22
summary: How the freshness signal works, what happens when a listing goes unconfirmed, and how to keep yours ranking.
tags: [freshness, ranking, expiry, owner]
---

A marketplace is only useful if what it shows is actually available. Freshness is how we enforce that.

## How it works

Every listing carries a freshness state derived from when you last confirmed availability. Never confirmed? Posting counts as a confirmation, so the clock starts from the day you posted.

| State | Since last confirmed | Effect |
| --- | --- | --- |
| Active | Up to 7 days | Full ranking weight |
| Ageing | 8–14 days | Slightly lower ranking. Buyers are told nothing. |
| Stale | 15–30 days | Demoted, and buyers see that availability is unconfirmed |
| Dormant | Over 30 days | Hidden from buyer search until you reconfirm |

The state is recalculated on every read, so it is never stale in itself — and one tap on **Confirm available** from **Dashboard → My listings** puts a dormant listing straight back to Active.

## Why we do this

Tenants abandon a platform after two or three wasted calls on properties that are already gone. Enforcing freshness costs owners one tap a fortnight and is the reason enquiries here convert at the rate they do.

> [!NOTE]
> Dormant is not deleted. Nothing is lost — reconfirm and the listing returns to search immediately with its history intact.

## Keeping a listing ranking well

On the default **Relevance** sort, listings are scored. In descending order of weight:

1. **Featured placement** — the only paid term, and it outranks everything below it
2. **Verified owner** — ID and selfie reviewed by our trust team
3. **Ownership verified** — ownership documents seen, and still current
4. **RERA registered** — a valid registration number on the project
5. **Freshness** — Active, then Ageing, then Stale. Dormant scores zero.
6. **Completeness** — carpet area, maintenance, availability date, photos

Every term except the first is free and within your control, and no amount of completeness substitutes for a verification. See [Plans explained](/help/a/plans-explained) before assuming visibility is something you have to buy.

Switching the sort to **Newest** or a price order turns all of this off — including featured placement. A buyer who picks an order gets that order.

## When you rent it out

Mark the property **Rented** rather than letting it go dormant. Open enquiries are notified, and the listing is delisted cleanly.

## Related

- [Posting your first listing](/help/a/post-a-listing)
- [Managing enquiries](/help/a/managing-leads)
