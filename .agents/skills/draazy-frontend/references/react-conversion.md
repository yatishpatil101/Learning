# PuneNest: HTML prototype → React conversion plan

This prototype was always intended to become a real React + backend app. The current static HTML is a
**design-phase validation** of UX and flows. Use this plan when the user is ready to convert.

## Guiding principles

- **Don't rewrite everything at once.** Migrate module-by-module behind a consistent shell.
- **The admin/ops back-office is the natural first React module** — it is self-contained, has clear data
  needs, and benefits most from real auth + an API. The consumer site can follow.
- **Map the existing abstractions directly:**
  - Each HTML page → a React route/page component.
  - `injectAdmin(...)` → a shared `<AdminLayout>` (sidebar/topbar) component.
  - `AdminUI.*` helpers → reusable components/hooks (`<Badge>`, `<Table>`, `useToast`, `<Modal>`, chart
    components).
  - `AdminData.*` → a typed API client (`/api/...`); during transition it can keep a localStorage adapter
    so screens work before the backend exists.
  - `auth.js` role guards → real auth (server sessions/JWT) + route guards / middleware. Replace the mock
    `localStorage` "security" with enforced server-side authorization.

## Recommended stack

- **React + Vite + TypeScript** (fast, simple; or Next.js if SSR/SEO for the consumer site matters — it
  likely does for listings, so consider Next.js App Router for the consumer side later).
- **Tailwind CSS** (already the design language — port the theme to a real Tailwind config + design tokens
  so admin and consumer stay consistent).
- **Component primitives**: a headless/accessible library (e.g. Radix or shadcn/ui patterns) so dropdowns,
  modals, and selects are accessible by default — this replaces the hand-rolled `.pn-dropdown` portal logic.
- **Charts**: keep Chart.js (via `react-chartjs-2`) or switch to Recharts.
- **Data fetching**: TanStack Query against the API client.
- **Backend**: any REST/GraphQL service; model entities from `admin-data.js` (listings, users, staff,
  tickets, enquiries, content/FAQs/banners, finance, settings, flags).

## Suggested migration order

1. **Scaffold** Vite+TS+Tailwind; port the Tailwind theme/tokens; set up routing and an `<AdminLayout>`.
2. **Back-office first**: port admin + ops pages to routes, build the shared component library from
   `AdminUI`, and put `AdminData` behind an API client (localStorage adapter initially).
3. **Real auth**: implement server auth + role-based route guards; remove mock guards.
4. **Backend + DB**: stand up the API and persist real data; swap the localStorage adapter for live calls;
   wire real consumer actions (e.g. a `services.html` / `rent-agreement.html` request creates a live ticket
   in the ops queue — currently only listings merge into the verification queue via `mergeRealListings`).
5. **Consumer site**: migrate consumer pages (consider Next.js for SEO on listing/property pages); reuse
   the same component library and tokens.
6. **Close known product gaps** from the business plan: consumer-facing map + commute search, and the
   society-SaaS module.

## Things to carry over carefully

- The **dropdown accessibility/portal behavior** — replace with an accessible primitive rather than
  reimplementing the body-portal hack.
- The **deterministic analytics seeding** is only for the mock; real analytics come from the backend.
- Keep the **trust/verification UI** prominent — it is a core acquisition lever, not just decoration.
- Preserve **role separation** (admin vs staff teams) and enforce it on the server, not the client.
