# Draazy — Legal Entity, Registration & Compliance (India)

> **Status:** Advisory / launch-gate reference. Companion to
> [`platform-architecture.md` §9](./platform-architecture.md#9-production-prerequisites--legal-dependencies-india),
> which maps *which vendor seams* need a registered entity. This doc answers *what entity to form*
> and *how*.
>
> ⚠️ **Disclaimer:** decision-support map, **not** a substitute for a signed opinion from a
> practising CA / CS / lawyer. Regulations cited are current to 2024–2026; **confirm live fees,
> thresholds, and the MahaRERA / DPDP specifics with a professional before filing.**

---

## 1. Executive Summary

**Draazy** is a technology **marketplace / broking-services platform** (not a land-dealing
"real-estate business"), earning from **subscriptions, listing boosts / featured placement, and a
platform fee on rent** — explicitly **fee-only, not holding customer funds** (a deliberate choice
that keeps you out of RBI Payment-Aggregator licensing). You handle **PII + Aadhaar-derived KYC
data** and integrate regulated seams (Razorpay, KYC aggregator, DLT SMS, WhatsApp), and are
architected to **scale to millions with a clear future-funding path**.

**Bottom line: incorporate a Private Limited Company.** It's the only structure that simultaneously
gives you limited liability, **ESOP capability**, **angel/VC investability**, **DPIIT Startup
recognition** (3-year tax holiday + abolished angel tax), and clean scalability. Every other
structure fails on at least one dimension a fundable tech startup cannot compromise on.

**Two real-estate-specific flags most advisors miss:** (a) **MahaRERA real-estate-agent
registration** likely applies to your brokerage/facilitation activity; (b) **DPDP Act** duties are
elevated because you touch Aadhaar-linked identity data.

---

## 2. Recommended Business Structure

### Private Limited Company (Pvt Ltd) — under the Companies Act, 2013

**Why it's the best fit for Draazy:**
- **Fundability:** Angels/VCs invest via equity/CCPS **only** into a company. Non-negotiable if you'll raise.
- **ESOP:** Grant stock options to early hires (critical when cash-constrained) — LLP/OPC effectively cannot.
- **Limited liability:** Founders' personal assets ring-fenced — important given data-breach / consumer-liability exposure.
- **DPIIT / Startup India:** Unlocks the **80-IAC 3-year tax holiday**, self-certification on labour/environment laws, easier tenders.
- **Perpetual succession + credibility:** Vendors (Razorpay, Meta, KYC aggregators) onboard companies most smoothly.
- **Tax efficiency:** Optional **22% regime (Sec 115BAA)**, or stay in the normal regime to exploit the 80-IAC holiday.

**Assumption:** you have **>=2 founders** *or* intend to raise external capital. If you are a **solo
founder who will raise later**, still go **Pvt Ltd** (not OPC) — see §3.

---

## 3. Comparison Table — All Entity Types

Scores out of 10 (higher = better for *your* fundable-tech-startup profile).

| Criterion | Sole Prop | Partnership | LLP | **Pvt Ltd** | OPC |
| --- | --- | --- | --- | --- | --- |
| Setup cost (low burden) | 10 | 9 | 7 | 6 | 6 |
| Compliance burden (lighter=higher) | 10 | 8 | 7 | 4 | 5 |
| Liability protection | 1 | 1 | 8 | **10** | 9 |
| Taxation efficiency | 5 | 5 | 6 | **9** | 7 |
| Ability to raise funding | 1 | 2 | 4 | **10** | 2 |
| ESOP capability | 1 | 1 | 2 | **10** | 2 |
| Scalability | 2 | 3 | 6 | **10** | 4 |
| Investor attractiveness | 1 | 1 | 4 | **10** | 2 |
| Founder flexibility | 9 | 6 | 7 | 7 | 5 |
| DPIIT / Startup India benefits | 3 | 3 | 8 | **10** | 8 |
| **Verdict (fundable-startup lens)** | Low | Low | Medium | **★ Highest** | Medium-Low |

**Why the others are less suitable:**
- **Sole Proprietorship / Partnership** — **unlimited personal liability** (fatal given data/consumer risk); no equity, no ESOP, uninvestable. Fine only for a hobby project.
- **LLP** — good liability + lighter compliance, but **cannot issue shares or ESOPs**; **VCs/angels avoid LLPs**. A dead-end if you'll raise. Reconsider **only** if you commit to lifelong bootstrapping.
- **OPC** — limited liability for a solo founder, **but** no equity funding, no practical ESOP, capped (must convert to Pvt Ltd on crossing **₹2 Cr turnover / ₹50 L paid-up capital**), resident nominee only. You'd just convert later — so **start as Pvt Ltd**.

---

## 4. Registration Roadmap (Pvt Ltd via MCA SPICe+)

1. **Digital Signature Certificate (DSC)** for all directors — licensed CA (Class 3). *(1–2 days; ₹1,000–2,000/director.)*
2. **Name reservation** — MCA **SPICe+ Part A** (check trademark + MCA name availability; keep "Draazy" consistent with your TM filing). *(1–3 days.)*
3. **SPICe+ Part B (incorporation)** with linked forms:
   - **eMoA (INC-33)** + **eAoA (INC-34)** — charter documents.
   - **AGILE-PRO-S (INC-35)** — bundles **GST (optional here), EPFO, ESIC, Professional Tax (Maharashtra), bank account**.
   - **DIN** for directors auto-allotted (up to 3) within SPICe+.
4. **PAN + TAN** — auto-generated on incorporation (no separate filing).
5. **Certificate of Incorporation (COI)** issued by MCA / CRC.
6. **Post-incorporation:** open current account, deposit subscription capital, file **INC-20A (commencement)** within 180 days, appoint **first auditor** within 30 days.

**Required documents:** PAN + Aadhaar of directors; passport photos; address proof (bank
statement/utility <=2 months); **registered office proof** (rent agreement + NOC + latest utility
bill); DSC; email/mobile.

**Estimated statutory + professional cost:** **₹8,000–₹25,000** all-in (varies by state stamp duty
on MoA/AoA and authorized capital; keep authorized capital modest, e.g., ₹1–10 L). **Timeline:
~7–15 working days.**

---

## 5. Compliance Checklist

**A. Mandatory / at incorporation**
- PAN + TAN — auto with SPICe+.
- **GST registration** — **register early**; effectively required for Razorpay settlement, interstate/online service supply, and input credit. Brokerage/marketplace services = **18% GST**. (Threshold ₹20 L for services, but online/interstate nature usually forces earlier registration.)
- **Professional Tax (Maharashtra)** — **PTEC + PTRC** (AGILE-PRO-S / Maharashtra portal).
- **Shops & Establishment Act (Maharashtra)** registration for the Pune office.
- **EPFO / ESIC** — allotted at incorporation; actual compliance triggers at 20 / 10 employees respectively.

**B. Startup-specific (do these — mostly free, high ROI)**
- **Startup India registration** (free) -> **DPIIT Recognition** (free): unlocks **80-IAC tax holiday**, self-certification, tender relaxations.
- **MSME / Udyam** (free): subsidies, faster-payment protection, fee rebates (incl. **50% trademark fee**).

**C. Sector-specific (real estate — the flags not to miss)**
- ⚠️ **MahaRERA Real-Estate Agent registration** — under RERA 2016 + MahaRERA rules, agents **facilitating sale/purchase of RERA-registered projects** must register. Your brokerage/lead-facilitation likely triggers this. **Scope with a MahaRERA-savvy lawyer** before monetizing brokerage. (Rental-only facilitation is lower-risk than sale facilitation.)
- **Consumer Protection Act / e-commerce rules** — accurate listings, grievance redressal, no misleading claims.

**D. Data & IT**
- **DPDP Act, 2023** — you're a **Data Fiduciary**: consent notices, purpose limitation, **grievance officer**, breach reporting, retention limits. **Elevated** because you touch **Aadhaar-derived KYC** (store only the UID token + masked ref, never raw Aadhaar — already in the architecture, ADR-009).
- **IT Act + SPDI Rules** — reasonable security practices; publish **Privacy Policy + Terms**.

**E. Not applicable / avoidable**
- **IEC (Import-Export Code)** — not needed (no cross-border goods).
- **RBI Payment-Aggregator licence** — **avoided by design** (fee-only; you never hold/settle rent funds). Keep it that way at MVP; moving funds later (Razorpay Route/escrow) shifts this to Razorpay, not you.
- ⚠️ **RBI/FEMA (FC-GPR)** — **only if you take foreign investment** later (FIRMS portal reporting).

**F. Recurring annual (Pvt Ltd)**
- ROC: **AOC-4** (financials), **MGT-7/7A** (annual return), **DIR-3 KYC**, **ADT-1** (auditor), board meetings + minutes; **statutory audit** (mandatory regardless of turnover); Income-tax return; monthly/quarterly **GST returns**; **TDS** returns.

---

## 6. Tax & Funding Analysis

### Tax
- **Corporate tax options:** **25%** (turnover <= ₹400 Cr) under normal regime **with** exemptions, **or 22% (Sec 115BAA)** without exemptions (also removes MAT). **Strategy:** if DPIIT-recognised, stay in normal regime to use the **80-IAC 100% profit deduction for 3 of first 10 years**, then evaluate 115BAA.
- **Angel tax:** **Abolished for all investors from FY 2024-25** (Finance Act 2024 scrapped Sec 56(2)(viib)) — major de-risking for future raises. DPIIT recognition still valuable for the tax holiday.
- **GST:** Output **18%** on subscriptions, listing/boost/featured fees, platform/brokerage fees; **claim input credit** on Razorpay fees, cloud (GCP/Cloudflare — note reverse-charge on some foreign SaaS), KYC/SMS vendors. Watch **TDS you must deduct:** **194-H** (commission), **194-I/194-IB** (rent), **194-J** (professional fees).
- **Entity comparison:** Pvt Ltd's **22–25%** (with holiday -> effectively lower early) beats Partnership/LLP's flat **30% + surcharge/cess**; Sole Prop taxed at individual slabs (up to 30%) with unlimited liability. **Pvt Ltd wins on rate and reliefs.**

### Funding readiness

| Path | Fit | Notes |
| --- | --- | --- |
| **Bootstrapping** | Now | The $0 free-tier architecture is *built* for this. |
| **Angel** | High (Pvt Ltd) | Equity/CCPS; DPIIT + no-angel-tax help; SAFE/CCPS common. |
| **Venture Capital** | High (Pvt Ltd) | VCs fund **only companies**; ESOP pool expected. |
| **Foreign investment** | Allowed (with care) | **FDI permitted in real-estate broking/marketplace services** under the automatic route; **prohibited in "real estate business"** (dealing in land/buildings). Your model is broking/marketplace -> allowed. File **FC-GPR** on FIRMS within 30 days of allotment. |

**Investor-ideal structure:** **Pvt Ltd** with a clean cap table, an **ESOP pool (10–15%)**, and DPIIT recognition.

---

## 7. Intellectual Property Strategy

| IP | Register? | What / Class | Indicative cost |
| --- | --- | --- | --- |
| **Trademark** ("Draazy" wordmark + logo) | **Yes, priority** | File **TM-A**, **Class 36** (real-estate/financial services) + **Class 42** (SaaS/tech); consider **Class 35** (online marketplace/advertising) | **₹4,500/class** govt (startup/MSME rate) + professional ₹3–8k. **Udyam gets the reduced fee.** |
| **Copyright** (source code, UI, content) | Optional | Auto-protected on creation; register for stronger evidentiary proof (Form XIV) | ₹500–2,000 govt + professional |
| **Patent** | Usually skip | Software "per se" isn't patentable in India absent a technical effect; not worth it now | — |
| **Domains** | Yes | Defensively register **draazy.com/.in/.co.in** + variants | ₹1–2k/yr each |

**Do first:** clear the **"Draazy" trademark search *before* finalizing the MCA name** so the
company name and brand don't diverge.

---

## 8. Estimated Costs (Indicative)

**One-time**
- Incorporation (govt + professional): **₹8,000–₹25,000**
- DSCs (per director): **₹1,000–₹2,000**
- Trademark (2 classes, w/ Udyam rate + professional): **₹12,000–₹22,000**
- Startup India + DPIIT + Udyam: **₹0** (professional help optional ₹3–8k)
- Domains: **₹3,000–₹6,000**
- **Total one-time: ~₹30,000–₹60,000**

**Annual (recurring)**
- Statutory audit + accounting + ROC/IT/GST filings (small startup): **₹25,000–₹70,000/yr**
- Professional Tax, DSC renewals, misc: **₹5,000–₹15,000/yr**
- MahaRERA agent registration (if applicable): **~₹10,000–₹25,000** — confirm current MahaRERA fee.
- **Total annual: ~₹35,000–₹1,00,000/yr** (scales with headcount/turnover)

---

## 9. Action Plan — Next 30 Days

**Week 1**
1. **Trademark availability search** for "Draazy" (Class 36/42/35) — lock the brand before the MCA name.
2. Decide cap table + **founder shareholding + ESOP pool (~10–15%)**; draft a simple **Founders' Agreement**.
3. Engage a **CA/CS** (many offer a fixed-fee incorporation package).

**Week 2**
4. Obtain **DSCs**; file **SPICe+ Part A** (name reservation).
5. Prepare registered-office proof (rent + NOC + utility) and director KYC docs.

**Week 3**
6. File **SPICe+ Part B + INC-33/34 + AGILE-PRO-S** (GST/PT/EPFO/ESIC/bank). Receive **COI + PAN + TAN**.
7. **File the trademark (TM-A).**

**Week 4**
8. Open **current account**; deposit subscription capital; file **INC-20A**; **appoint first auditor (ADT-1)**.
9. Apply **Startup India -> DPIIT recognition** and **Udyam/MSME** (free).
10. **Legal scoping call on MahaRERA + DPDP**; draft **Privacy Policy + Terms** for the app.

---

## 10. Final Recommendation

**Incorporate Draazy as a Private Limited Company now**, and immediately layer on **DPIIT
recognition + Udyam** (free, high-value) and the **"Draazy" trademark**. This structure is the
**only** one that keeps every future door open — angel/VC funding, ESOPs for early hires, limited
liability against your data/consumer risk, and the 80-IAC tax holiday — while your **fee-only,
seam-based architecture already sidesteps the heaviest regulatory burden (RBI payment-aggregator
licensing).**

The **two sector-specific items to action deliberately** — because they're where real-estate
startups get caught — are **MahaRERA agent registration** (scope it before monetizing brokerage) and
**DPDP compliance** (elevated by Aadhaar-linked KYC; the architecture already stores only the UID
token, which is exactly right).

**Scenario notes / assumptions made:**
- *If solo founder:* still **Pvt Ltd** (not OPC) if you'll ever raise or grant ESOPs.
- *If you truly will never raise and want minimal compliance:* **LLP** is the only defensible alternative — but you forfeit ESOPs and investability.
- *If foreign co-founder/investor from day one:* Pvt Ltd + plan **FEMA/FC-GPR** reporting; confirm the broking-vs-real-estate-business FDI distinction with counsel.
