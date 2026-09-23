---
name: real-estate-expert
description: Domain expert for building React real-estate web apps (property listings, search/filter, map integration, listing detail pages, lead capture, and India-first real-estate flows like NoBroker/MagicBricks/PuneNest) with deep India-market knowledge across property types (flats, commercial, farmland, plots), online search behavior on Indian platforms, real-estate legal processes, and brokerage practices. Use when implementing or reviewing real-estate features — property cards, search & filters, map popups, listing wizards, BHK/rent/commercial/PG/flatmate flows, contact gates, alerts, and admin/ops portals. Covers data modeling for listings, SEO for property pages, and conversion-focused UX.
---

# Real Estate Expert

Domain knowledge for building and reviewing React real-estate applications. Use this
alongside `punenest-frontend`, `ui-ux-pro-max`, `frontend-design`, and
`react-best-practices`.

## When to use

- Building or editing property listings, search, filters, map views, or listing detail pages.
- Implementing listing wizards (list-property flows), BHK/rent/commercial/PG/flatmate variants.
- Contact/Aadhaar gates, lead capture, saved searches, and property alerts.
- Admin / ops back-office features (properties, users, finance, reports, analytics).
- Data modeling for listings, seed data, and SEO for property pages.

## India-market domain expertise

This skill carries practitioner-level knowledge of the Indian real-estate market. Apply it
to make listings, flows, and copy realistic and legally sound for Indian users.

### Property types across the Indian market
Model and support the full spread of Indian property categories, not just apartments:
- **Residential flats/apartments**: BHK configurations, carpet vs. built-up vs. super built-up area, RERA carpet-area norms, furnishing tiers, society/maintenance charges.
- **Commercial properties**: offices, shops, showrooms, co-working, warehouses/godowns, industrial units — track carpet/built-up, per-sq-ft pricing, CAM charges, and lock-in periods.
- **Farmland / agricultural land**: acre/guntha/bigha units, agricultural-use restrictions, conversion (NA — non-agricultural) status, and buyer-eligibility rules that vary by state.
- **Plots / land**: residential/NA plots, gated-community plots, dimensions and frontage, boundary/khata details, and clear-title emphasis.
- Use region-appropriate area units (sq ft, sq yd, acre, guntha, bigha, cent) and always store a canonical unit alongside the display unit.

### Online property search behavior in India
Understand how Indian buyers/renters actually search, and mirror those patterns:
- **Platforms**: NoBroker (broker-free rentals/sales), MagicBricks, 99acres, Housing.com, Facebook Marketplace and local Facebook/WhatsApp groups, OLX, and neighborhood broker networks.
- **Intent modes**: distinct rent / buy / sale (resale vs. new) journeys — filters, urgency, and trust signals differ per mode.
- **What customers actually filter on**: locality/landmark, budget band, BHK, furnishing, availability/possession date, broker vs. owner, amenities, and proximity to work/schools/metro.
- **Trust concerns**: fear of fake listings and broker spam — users value owner-direct listings, verified photos, recent freshness, and genuine contact details. Design search and cards to surface these signals.

### Real-estate legal knowledge (India)
Know the legal framework and transaction processes so flows and copy stay compliant:
- **RERA** (Real Estate Regulation Act): project/agent registration, RERA IDs, carpet-area disclosure — validate and surface RERA IDs where present.
- **Title & documents**: sale deed, title deed, mother deed, encumbrance certificate (EC), khata/7‒12 extract, mutation records, and clear-title verification.
- **Transaction process**: agreement to sell → due diligence → sale deed execution → registration at sub-registrar, with **stamp duty and registration charges** (state-specific).
- **Taxes & finance**: TDS on property purchase (over threshold), capital gains, GST on under-construction property, and home-loan/EMI basics.
- **Rentals**: rental/leave-and-license agreements, security deposits, registration norms, and tenant/landlord obligations.
- Treat all of this as domain guidance for building compliant features and copy — not as a substitute for a licensed lawyer; prompt users to seek professional legal advice for actual transactions.

### Brokerage & customer-need expertise
Think like an experienced Indian real-estate broker who knows what customers want:
- Qualify leads by intent (rent/buy/sale), budget, timeline, and locality preference.
- Match customers to inventory quickly, handle site-visit scheduling, and follow up on leads.
- Understand brokerage/commission norms and the owner-vs-broker dynamic (e.g., NoBroker's positioning).
- Anticipate common buyer/tenant questions (possession, negotiability, hidden charges, legal clarity) and surface those answers proactively in listings and flows.

## Core domain model

Real-estate listings share a consistent shape. Prefer one normalized listing model with a
`listingType` discriminator rather than divergent per-type objects:

- **Identity**: `id`, `slug`, `title`, `createdAt`, `updatedAt`, `status` (draft/active/expired/sold).
- **Type**: `listingType` (`buy` | `rent` | `commercial` | `pg` | `flatmate`), `propertyType` (apartment, villa, plot, office, shop...).
- **Location**: `city`, `locality`, `address`, `lat`, `lng`, `pincode` — always keep lat/lng for map popups.
- **Specs**: `bhk`, `area`, `areaUnit`, `furnishing`, `floor`, `totalFloors`, `facing`, `possession`.
- **Pricing**: `price`, `priceUnit`, `deposit`, `maintenance`, `negotiable`, `reraId` (validate when present).
- **Media**: `images[]`, `video`, `floorPlan` — always have a deterministic placeholder fallback.
- **Owner/agent**: `postedBy`, `contact` (gated behind auth/Aadhaar), `verified`.

## Feature patterns

### Search & filters
- Make filters **type-aware**: rent shows deposit/furnishing; commercial shows carpet/built-up; PG shows sharing; flatmate shows preferences.
- Derive filter options from data, never hardcode. Keep filter state in the URL for shareable/back-button-safe searches.
- Debounce text search; keep map + list in sync from a single source of truth.

### Property cards & detail pages
- Cards: image with fallback, price, BHK/area, locality, verified badge, and one primary CTA.
- Detail pages: gallery, key specs grid, map, similar listings, and a contact CTA gated appropriately.
- Never leak owner contact before the gate (auth/Aadhaar) is passed.

### Maps
- Keep marker data minimal (id, lat, lng, price) for performance; lazy-load full popup content on click.
- Guard against missing lat/lng — skip the marker, don't crash the map.

### Listing wizards (list-property)
- Multi-step with progress, per-step validation, reset, and step navigation.
- Persist draft to autosave so a refresh never loses work.
- Validate RERA, possession dates, and pricing at the step boundary, not on submit only.

## SEO for property pages

- Server-render or pre-render titles/descriptions per listing; include locality + city + type.
- Add structured data (`schema.org/RealEstateListing` / `Product` + `Offer`) where possible.
- Keep `sitemap.xml` updated with active listings; exclude drafts/expired.

## Conversion & trust UX

- Surface trust signals: verified badges, freshness ("posted 2 days ago"), and owner/agent info.
- Make the primary action (contact / schedule visit / save) obvious and above the fold.
- Prevent stale listings from ranking — enforce listing freshness and expiry.

## Guardrails

- Immutable updates to listing state; never mutate arrays of listings in place.
- Validate all listing input at the boundary (wizard steps, admin forms, seed scripts).
- Deterministic placeholders for missing media/prices to keep tests stable.
- Keep the same normalized model across consumer site, admin portal, and seed/mock data.
