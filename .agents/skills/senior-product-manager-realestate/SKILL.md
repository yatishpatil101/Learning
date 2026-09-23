---
name: senior-product-manager-realestate
description: Senior Product Manager expertise specialized in real-estate app building (India-first marketplaces like NoBroker/MagicBricks/PuneNest), grounded in the Indian market across property types (flats, commercial, farmland, plots), how customers search online on Indian platforms, real-estate legal/transaction requirements, and brokerage practices. Use when defining product scope, writing PRDs/specs, prioritizing features, shaping user flows, defining success metrics, or making product tradeoffs for real-estate features — listings, search, contact gates, lead funnels, alerts, wizards, and admin/ops. Turns vague requests into crisp, buildable, metric-driven product decisions before code is written.
---

# Senior Product Manager — Real Estate

Product-management judgment for a real-estate marketplace. Use this BEFORE implementation
to turn a request into a clear, prioritized, measurable plan. Pair with `real-estate-expert`
(domain model), `ui-ux-pro-max` / `frontend-design` (design), and `punenest-frontend`
(project conventions).

## When to use

- Turning a vague feature request into a crisp scope and acceptance criteria.
- Writing or refining a PRD, user story, or spec before building.
- Prioritizing what to build, defer, or drop; resolving product tradeoffs.
- Defining success metrics and how a feature will be measured.
- Reviewing whether a built feature actually solves the user + business problem.

## Operating principles

- **Problem before solution**: state the user problem, who has it, and why it matters before proposing UI.
- **Thin vertical slices**: ship the smallest end-to-end flow that delivers value; iterate.
- **Metric-driven**: every feature has a primary success metric and a guardrail metric.
- **Trust is the product**: in real estate, verification, accuracy, and no-spam trust beat feature count.
- **Say no**: protect scope; defer nice-to-haves and record them, don't silently build them.

## Real-estate personas

- **Seeker** (buy/rent/PG/flatmate): searches, filters, shortlists, contacts. Cares about relevance, trust, speed.
- **Lister** (owner/agent): posts and manages listings. Cares about easy posting, reach, and quality leads.
- **Ops/Admin**: moderates listings, manages users/finance/reports. Cares about control, fraud prevention, and freshness.

## India-market product context

Ground every product decision in how the Indian real-estate market actually works. Use this to
scope features, shape flows, and pick metrics that fit real user behavior and legal reality.

### Segment by property type
Each property category is a distinct product problem — don't force one flow to fit all:
- **Residential flats/apartments**: BHK, carpet/built-up area, furnishing, society/maintenance — highest volume, optimize the core funnel here first.
- **Commercial** (office, shop, showroom, co-working, warehouse): per-sq-ft pricing, CAM, lock-in — buyers are businesses; prioritize precise specs and serious-lead filtering.
- **Farmland / agricultural land** (acre/guntha/bigha, NA conversion, buyer eligibility): niche, legally sensitive — emphasize title clarity and eligibility disclosures over volume.
- **Plots / land** (residential/NA plots, dimensions, khata, clear title): buyers fear disputes — make title/verification the headline trust signal.
- Support region-appropriate area units and let type drive which filters, fields, and trust cues appear.

### Design for how Indians search online
Customers already search on NoBroker, MagicBricks, 99acres, Housing.com, Facebook Marketplace/groups, and OLX. Meet those expectations:
- Separate **rent / buy / sale** intents — different urgency, filters, and trust needs per mode.
- Prioritize the filters users actually reach for: locality/landmark, budget band, BHK, furnishing, possession/availability, **owner vs. broker**, and proximity to work/school/metro.
- The #1 differentiator is **trust**: owner-direct listings, verified photos, genuine contacts, and freshness beat raw inventory count. Make trust a first-class product goal, not a badge.

### Let legal reality shape requirements
Transaction and compliance rules are product constraints, not afterthoughts:
- **RERA** registration/IDs and carpet-area disclosure where applicable — surface and validate them.
- Title/document expectations (sale deed, EC, khata/7–12, mutation) drive verification features and copy.
- Transaction milestones (agreement → due diligence → registration, stamp duty, TDS/GST) inform where to educate users and set expectations.
- Rentals need leave-and-license/agreement and deposit norms reflected in flows.
- Treat this as guidance for compliant features and honest copy — prompt users to consult a licensed lawyer for actual transactions; never present the app as legal advice.

### Think like a broker who knows what customers want
- Qualify leads by intent, budget, timeline, and locality; route serious leads efficiently.
- Reduce friction from search → shortlist → site visit → contact/close.
- Understand the owner-vs-broker and brokerage/commission dynamic (NoBroker's positioning) when scoping contact gates and lead flows.
- Proactively answer the questions buyers/tenants always ask — possession, negotiability, hidden charges, legal clarity — inside listings and flows.

## PRD checklist (write before building)

1. **Problem & user**: who, what pain, evidence.
2. **Goal & success metric**: primary metric + guardrail (e.g., contact-rate up, spam-report rate flat).
3. **Scope**: in-scope now vs. explicitly out-of-scope / later.
4. **User flow**: happy path + key edge cases (empty state, gated state, error state).
5. **Acceptance criteria**: testable statements a Playwright test could assert.
6. **Data/impact**: fields touched, seed/mock data needs, admin/ops impact.
7. **Risks & tradeoffs**: what could go wrong; the decision and why.

## Prioritization

- Use **RICE / value-vs-effort** framing for competing items; state the ranking rationale briefly.
- Prefer changes that improve the core funnel: **search → shortlist → contact → close**.
- Flag anything that adds user friction to a conversion step and justify it.

## Metrics that matter (real estate)

- **Funnel**: search-to-contact rate, listing-detail views, contact/lead conversion.
- **Supply quality**: verified-listing %, listing freshness, expired/stale ratio.
- **Trust/safety**: spam-report rate, fraud flags, contact-gate completion.
- **Retention**: saved searches, alert opt-ins, repeat sessions.

## Handoff to build

- Produce acceptance criteria concrete enough to become Playwright assertions.
- Note which skills/agents the build should use (`real-estate-expert`, design skills, reviewers).
- Keep the deferred/out-of-scope list so it can be revisited, not lost.
