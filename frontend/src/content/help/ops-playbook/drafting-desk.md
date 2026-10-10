---
title: Drafting desk and service queues
slug: drafting-desk
category: ops-playbook
audience: staff
access: staff
order: 10
updated: 2026-10-10
summary: How staff work rent-agreement drafting and other paid service-request queues.
tags: [ops, services, rent-agreement, drafting, internal]
modules: [desk:rental, desk:legal, desk:interior, desk:packers, desk:valuation]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Overdue** button count ? rent-agreement cases past their desk target.
- **SLA** cell on rent agreements: **Due in** turns warning at 2 h left, then **Overdue by**; **Customer's turn** has no desk timer.
- Targets: pick up within 4 h, first draft 48 h, revision 24 h, registration 7 days.
- **To pick up** count. Other desks have no SLA cell: row age is amber after 24 h and rose after 72 h.

**Work on**

- Work **Overdue** rent agreements first, then **To pick up** with **Take case**.
- Finish first drafts and **changes-requested** revisions before the targets run out.
- Release or send back drafts held for a second check ? it must be a different operator.
- Upload the registered copy for **approved** cases, then run **Registration check** and **Police intimation**.

## Desk and access

Each service is its own sidebar entry: **Rent Agreement** at `/admin/rent-agreement`, and **Property & Legal**, **Interior & Renovation**, **Packers & Movers** and **Property Valuation** at `/admin/legal`, `/admin/interior`, `/admin/packers` and `/admin/valuation`. Old `/ops/drafting-desk?type=…` and `/ops/<desk>` bookmarks redirect to the matching page.

A staff member sees only the service desks they were granted (**Rent Agreement** needs the rental desk function), under `/staff/…`. Admins and managers see every desk.

## Queue controls

| Control | Use it for |
| --- | --- |
| **To pick up / My cases / In progress / With customer / Closed** | Queue tabs with live counts (**My requests** on the other desks) |
| **Overdue** | Rent-agreement SLA breaches only |
| **Name, mobile or request id** | Server-side search |
| **Customer tickets** | The desk's tickets tab (needs `tickets:read`) |

The list is paged at 20 rows. A failed load is shown as an error, not as an empty queue.

## Status states

| Status | How it is reached | Staff action |
| --- | --- | --- |
| `awaiting-payment` | Paid service created before payment settles | Not in the working queue |
| `new` | Paid or free request ready for ops | Take it |
| `assigned` | **Take case** (rent agreement) or **Take this request** (other desks) | Start work |
| `in-progress` | Status set to in-progress | Continue work |
| `draft-shared` | **Share draft** succeeds | Customer reviews |
| `changes-requested` | Customer rejects the draft | Revise or cancel |
| `approved` | Customer approves the draft | Upload final or registered copy |
| `completed` | Final document uploaded | Run registration and police checks if rental |
| `cancelled` | Staff cancel with a reason | Terminal |

Only `assigned`, `in-progress`, and `cancelled` are directly staff-settable. `draft-shared`, `approved`, `changes-requested`, and `completed` are created by draft upload, customer decision, and final upload.

## Age and SLA targets

Rent agreements carry server SLA due dates:

| State | Target |
| --- | --- |
| `new` | Pick up within 4 hours |
| `assigned` / `in-progress` | First draft within 48 hours |
| `changes-requested` | Revision within 24 hours |
| `approved` | Registration within 7 days |
| `draft-shared` | Customer's turn; no desk timer |

The **SLA** cell shows **Due in**, **Overdue by**, or **Customer's turn** from that SLA. It turns warning when two hours or less remain. Non-rental queues fall back to age colouring: amber after 24 hours and rose after 72 hours while not completed or cancelled.

## Rent-agreement document procedure

1. Open the case. The rail shows the **next step** and whose move it is; the stage bar shows how far the case has come. Read **Parties** and **Property & terms**.
2. Use **Documents** to verify every required paper. If the checklist cannot load, retry before asking the customer for anything.
3. Check **Overlap check**. If another paid agreement overlaps the same flat and months, confirm the old tenancy ended or this is a replacement before drafting.
4. Use **Priced terms** only for rent, deposit, term, increment, or registration-area corrections. The customer must accept; any higher fee is paid before the draft goes out.
5. Use **Parties' identity numbers → Reveal** (inside **Parties**) only when you hold the matter. Hide or close the modal when done; reads and refusals are audited.
6. Share the draft only after the checklist is verified and no priced-term amendment is open.

## Draft checks and customer decision

Before **Share draft**, tick every drafting check: identity numbers, title proof, POA, address, and terms. The server refuses rent-agreement drafts without these checks.

A second-operator draft check is held when any risk reason applies:

| Reason shown | What to verify |
| --- | --- |
| **Rent is ₹50k or more** | High-value terms and tax exposure |
| **Co-owner is named** | Every licensor is on the deed |
| **Power of attorney is used** | POA is registered and covers leave-and-licence |
| **NRI / foreign party** | SRO route and passport particulars |
| **MOD-7 overlap** | Overlapping tenancy explanation |

The person who shared the draft and the current holder cannot release the risky draft. A different operator must **Check and release** or **Send back** with a note.

## Registration and trust evidence

After the customer approves the draft, upload the registered copy with the Sub-Registrar record: document number, Sub-Registrar office, registration date, GRAS GRN, stamp duty paid, and registration fee paid.

For Leave & Licence Article 36A pricing, the code charges stamp duty from rent, term, non-refundable deposit, and 10% of refundable deposit per chargeable year; registration is ₹1,000 urban or ₹500 rural, plus ₹300 handling. Correct the registration area with **Priced terms** before sharing a draft if the locality body is wrong.

After completion, use **Registration check**:

1. Open the registered copy.
2. Compare it with the approved draft and the registration record.
3. Confirm each tenant only if the number was OTP-verified and you did not upload the copy.
4. Use **Not on the copy** when the tenant is absent or not OTP-verified.

Confirmed registered tenancies can become trust evidence. Typed tenant numbers that were never OTP-confirmed cannot earn that badge.

## Police intimation

**Police intimation** appears after a rental request is completed. Draazy does not file tenant information with police. Record it only after the owner confirms submission to the relevant commissionerate. Add the acknowledgement reference and submission date when supplied.

## Refunds and cancellation

Use **Refunds** only on paid rent-agreement requests. The holder asks for a refund; a colleague approves it. The requester cannot approve their own refund. Before duty is paid, everything paid can be refunded. After GRAS duty is paid, only the refundable balance beyond statutory charges can go back.

Use **Cancel request** only before `completed` or `cancelled`. A cancellation reason is required and is sent to the customer.

## What never to do

- Never ask for documents when the checklist failed to load
- Never reveal identity numbers on a matter you do not hold
- Never share a rent-agreement draft with unverified papers
- Never approve your own refund or your own registered copy
- Never mark police intimation filed by Draazy
- Never use `registration` or `docs_review` as a staff status

## Related

- [Service queues](/help/a/service-queues)
- [Verification SLAs](/help/a/verification-sla)
- [Identity review](/help/a/identity-review)
- [Ownership and badges](/help/a/ownership-and-badges)
