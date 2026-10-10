# SEO · AIO · GEO — make every Draazy feature findable by Google and AI assistants

**Goal.** Every public feature has a crawlable page with its own title, description, canonical,
structured data and share preview, so Google, Bing (and through it Copilot / ChatGPT search),
Perplexity and Gemini can find, understand and cite it. Source: the 2026-10-09 audit (session
a703b2a3) — findings S1–S20 (SEO), A1–A6 (AIO), G1–G6 (GEO); IDs below cite them.

**Tracking.** This file is the ledger. Tick a slice only when its *Done when* holds. Any session picks
the first unticked slice whose dependencies are ticked; write `IN PROGRESS (<date>)` on its line first
so a parallel session skips it. `tasks/todo.md` `## In flight` holds one index line pointing here.

## Standing rules for this plan (user, 2026-10-09)

1. **🖥️ = touches a UI screen → ask the user first, every time.** The user prefers no UI change unless
   the slice needs one. Head tags, JSON-LD, HTTP headers, robots, sitemap, build output and Markdown
   content are *not* UI. Prerendered first-paint HTML that the SPA replaces is flagged 🖥️? — ask once
   per page family.
2. **No full e2e** (`run-fast.ps1 -Full`) until the user asks. Test only what a slice builds or touches:
   plugin self-tests, a scratch `vite build --outDir`, and the slice's own e2e spec via
   `e2e\run-fast.ps1 -Spec <repo-relative paths>`.
3. Reuse the build-time prerender pipeline (`vite-plugin-blog.mjs` exports `esc`, `jsonLd`, `headTags`,
   `renderPage`) before inventing anything. Dynamic pages go through a Cloudflare Pages Function.
4. Canonicals always point at `https://draazy.com`; only that host is indexable (slice 0.3).
5. **USER** = an action only the user can do (accounts, dashboards, outreach). The plan tracks it; code
   sessions do not block on it.

## Decisions needed (ask before the slice that needs it)

| # | Question | Blocks | Answer |
|---|---|---|---|
| D1 | Remove the hard-coded home stats + testimonials (`data/homeData.js` `STATS`, `Testimonials.jsx`) until real numbers exist? | 0.8 | 2026-10-09: replace with launch facts (₹0 brokerage, 100% OTP-verified members, 12 locality guides), hide testimonials; same on Sign-in and the Services hub |
| D2 | Share image `og-image.jpg`: generate a brand card (logo + "Pune homes from real owners") or supply one? | 0.9 | 2026-10-09: generate a brand card |
| D3 | AI *training* crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot, Applebot-Extended): allow or block? Retrieval bots stay allowed either way | 0.10 | 2026-10-09: allow all |
| D4 | Prerendered first-paint HTML (help, services, home): acceptable that crawlers and a slow first paint see a plain styled version before the app takes over? | 1.x | 2026-10-09: yes, ship readable content |
| D5 | Descriptive property URLs `/property/<slug>-<id>` with 301 from `/property/<id>` | 2.6 | 2026-10-09: yes, `/property/<bhk>-<type>-for-<deal>-<locality>-<id>` + 301 |
| D6 | Positioning line + home title ("Pune homes from real owners. Your number stays private.") | 6.x | 2026-10-09: privacy-first line; title says properties, not flats: "Draazy: Broker-free properties for rent & sale in Pune" |
| D7 | Each new page in phase 3 (about, how-verification-works, tools, landing pages, comparison) | 3.x | 2026-10-09: build all eight in plan order |
| D8 | Company facts for `/about`, JSON-LD and legal pages | 3.1 | 2026-10-09: name "Draazy Technologies" everywhere (Terms, `settings.json`, JSON-LD); support@draazy.com; no address anywhere (the Baner Road one is wrong); no founder names — "Built in Pune by the Draazy team" |
| D9 | Internal linking (phase 5) | 5.x | 2026-10-09: all four (guide → societies/listings, property → guide card, home strips, visible breadcrumbs) |
| D10 | Post author (4.3) | 4.3 | 2026-10-09: "Draazy Editorial Team" (Organization), no reviewer; small visible byline + "Updated <date>" under the title |
| D11 | Blog/locality share images (2.7) | 2.7 | 2026-10-09: generated at build time, brand card in the `og-image.jpg` style |
| D12 | Marathi pages (8.2) | 8.2 | 2026-10-09: after launch, once Search Console shows which guides earn traffic |
| D13 | Social profiles `sameAs` (7.1) | 7.1 | 2026-10-09: footer profiles, tracking params stripped; Facebook page `https://www.facebook.com/profile.php?id=61594205514968`; LinkedIn company page **USER: to send later** (current link is a personal `/in/` profile) |
| D14 | Fact review (4.4) | 4.4 | 2026-10-09: user chose to publish as is — no research pass |
| D15 | Off-site drafts (7.5, 7.6) | 7.5–7.6 | 2026-10-09: draft Reddit posts, 10 Quora answers, YouTube Shorts copy, media/listicle outreach list + email in `tasks/seo/` for the user to post |
| D16 | Rent numbers (4.6 tables, 3.7 report) | 4.6, 3.7 | 2026-10-09: cited third-party ranges now (source URL + as-of date on every table); switch to Draazy listing medians once a locality has ≥10 live listings |
| D17 | Comparison page (3.6) | 3.6 | 2026-10-09: name NoBroker; factual and dated; their published plans and fees vs ours, each claim linked to their own page; no adjectives |
| D18 | Landing-page index thresholds (3.4, 3.5) | 3.4–3.5 | 2026-10-09 (lead default): locality ≥5 open listings, BHK page ≥3, flatmate locality ≥3 live posts; below that the page works but is noindex and out of the sitemap |

---

## Phase 0 — Launch hygiene (mostly non-UI)

- [x] **0.1 Organization + WebSite JSON-LD in the shell** (A4, S13). `index.html` head: Organization
  (name, url, logo, description, areaServed Pune) and WebSite (name, url, inLanguage, publisher).
  `legalName` waits for incorporation (3.1), `sameAs` for the social profiles (7.1). No SearchAction:
  Google retired the sitelinks search box (2024). No canonical in the shell: it is the fallback for
  every route, so it would point them all at home (1.1 adds the home canonical).
  *Done when* both blocks parse as JSON on every page and the e2e asserts them.
- [x] **0.2 robots.txt hardening** (S7). Disallow private and per-user routes: `/admin`, `/staff`
  (prefix also covers `/staff-login`, `/staff-invite`), `/ops`, `/api/`, `/signin`, `/signup`, `/checkout`, `/dashboard`, `/owner-hub`, `/messages`,
  `/notifications`, `/saved`, `/support`, `/refer`, `/pay-rent`, `/tenant-profile`, `/verify-identity`,
  `/schedule-visit`. `/list-property` stays crawlable: it is public for guests and the owner keyword page.
  The document routes stay crawlable too, so their 0.4 `noindex` header is seen (a blocked URL can still
  be indexed bare).
  *Done when* the built robots.txt carries them and the sitemap line.
- [x] **0.3 Only draazy.com is indexable** (S4). Build reads `SITE_URL` (deploy.yml already sets it to
  `https://sandbox.draazy.com`); any other host gets `X-Robots-Tag: noindex` on `/*` in `_headers` and a
  `robots.txt` (no sitemap line) that lets only Googlebot and Bingbot crawl, so they see the `noindex` and
  drop any sandbox page indexed earlier; every other bot gets `Disallow: /`. ⚠️ The production deploy must set
  `SITE_URL=https://draazy.com` (or leave it unset), or production ships noindexed.
  *Done when* a build with `SITE_URL=https://sandbox.draazy.com` emits both, a default build emits neither.
- [x] **0.4 `X-Robots-Tag: noindex` on pages reachable by link** (S7) in `_headers`: `/shared-documents`,
  `/view-documents/*`, `/flatmates/:kind/:id` (individual flatmate posts, privacy; `_headers` allows one
  splat per rule, so placeholders). The other 0.2 routes are
  sign-in walls with no content, so robots.txt is enough. Verify on sandbox that Pages applies path
  headers to SPA-rewritten responses (`curl -I`): PENDING SANDBOX.
- [x] **0.5 Sitemap cleanup** (S6). Drop `/listings?deal=buy|rent` (query URLs) for `/listings`; add
  `/societies`, `/list-property` and the five missing services (`/reels` stays out — thin):
  `/services/rent-agreement`, `/services/packers-movers`, `/services/property-legal`,
  `/services/interior-renovation`, `/services/property-valuation`. Blog, locality and help entries stay
  plugin-generated.
- [x] **0.6 `/llms.txt`** (A5). llmstxt.org format: `# Draazy`, a `>` summary, then blog, locality hub,
  help, services.
- [ ] **0.7 `lang="en-IN"`** (S9). Low value; `i18n.spec.js` and `help-urls.spec.js` assert `lang="en"`
  and i18n owns the attribute — do it with the Marathi work (8.2), not alone.
- [x] **0.8 🖥️ Remove fabricated stats/testimonials** (G3, messaging). Needs **D1**. Legal exposure
  (Consumer Protection Act, CCPA 2022 misleading-ads guidelines, BIS IS 19000:2022 online reviews).
  `STATS` now holds launch facts only; home Testimonials, the Sign-in quote and the Services quotes are
  deleted; the Services "Buy a Home" card drops "10,000+". Swap in live counts (bootstrap `counts`) once
  stock is real.
- [x] **0.9 `public/og-image.jpg` 1200×630** (S3). Needs **D2**. Every page referenced it and it 404'd,
  so every WhatsApp/LinkedIn/X share showed no image. Now a 50 KB dark brand card (wordmark, "Broker-free
  homes in Pune.", the D mark), rendered with Playwright from the app's Outfit font; the shell also
  declares `og:image:width/height/alt`.
- [x] **0.10 AI-bot policy in robots.txt** (A2). **D3 = allow all**, so no bot-specific group: the `*`
  group already covers them, and an explicit group would have to repeat the 0.2 disallows. Cloudflare can
  still block them at the edge, which is what 0.11 checks.
- [ ] **0.11 USER — Cloudflare AI Crawl Control.** Dashboard → AI Crawl Control / Bots: make sure
  OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User, Bingbot,
  Applebot are **not** blocked; check whether a Cloudflare-managed robots.txt is prepended.
- [ ] **0.12 USER — Search consoles.** Google Search Console + Bing Webmaster Tools (domain property for
  `draazy.com`), submit `https://draazy.com/sitemap.xml`; Cloudflare → Caching → **Crawler Hints** on
  (sends IndexNow to Bing/Yandex). Do it the day production goes live.

## Phase 1 — Prerender every static public page (build time, non-UI unless 🖥️?)

Mechanism: the help/blog/locality plugin pattern — write `dist/<route>.html` with route-specific head
tags + JSON-LD, served by Pages at `/<route>`. Two levels:
*head-only* (shell + correct title/description/canonical/OG/JSON-LD, empty `#root`) — pure non-UI;
*full* (also the readable content inside `#root`) — needs **D4**.

- [x] **1.1 Home head split** (S1, S13). Landed with 1.5, more simply than drafted: the home prerender runs
  in the route-heads plugin's `closeBundle`, after every `writeBundle` reader and spa-fallback's 404.html
  copy have used the bare `index.html`, so no plugin needs to read `404.html`. PWA `navigateFallback` is
  `404.html` (the precache revision of the rewritten `index.html` was checked to match). `ROUTE_HEADS['/']`
  holds home's head (description cut to 147 chars; the shell's 173 stays for unprerendered routes), and
  `StaticRouteHead` owns the home canonical in-app. The shell itself still has no canonical.
  **PENDING SANDBOX:** `curl -sI /404.html` should end in 200 after the 308 to `/404`, or the service worker
  can't precache its fallback and fails to install.
- [x] **1.2 Head-only prerender for static routes**: `/listings`, `/societies`, `/flatmates`, `/services`,
  `/home-loans`, `/emi-calculator` (+ WebApplication JSON-LD), `/plans`, `/contact`, `/list-property`,
  legal pages, the five service pages (+ Service JSON-LD: provider Draazy, areaServed Pune; no `offers`,
  prices come from the API). Copy approved as drafted. `src/data/routeHeads.js` →
  `scripts/vite-plugin-route-heads.mjs` (build) + `StaticRouteHead` in `App.jsx` (in-app nav).
  `/reels` skipped: not in the sitemap. A page that sets `document.title` itself overrides the table
  (child effects run first), so `LegalPage` no longer does.
- [x] **1.3 Help centre prerender** (S1, A1). Full content (D4) for `/help`, `/help/faq`,
  `/help/changelog`, every public `/help/c/:id` (BreadcrumbList) and `/help/a/:slug` (Article +
  BreadcrumbList): 45 pages from `helpPages()` in `vite-plugin-help-content.mjs`; staff content is never
  prerendered. `useHelpSeo` deleted; `HelpLayout` takes `title/description/path/noindex` →
  `usePageHead`, and not-found states are now noindex. **FAQPage deferred**: FAQs are admin-edited API
  records (`/faqs`) with no build-time source, so a baked copy would drift; revisit with 1.5's home FAQ.
- [x] **1.4 Service pages full prerender** (user: "same as blog"). `routeBodies()` in
  `vite-plugin-route-heads.mjs` renders `/services`, the five service pages and `/home-loans` from
  `i18n/locales/en/services.json`, using only keys the screens render: hero, services, trust, steps,
  documents, legal's registration timeline, rent agreement's stamp-duty formula, and the FAQ, plus
  FAQPage JSON-LD in an `@graph` with Service. Stat strips are left out (6.5).
- [x] **1.5 Home full prerender** (user: "same as blog"). `homeBody()` renders only the sections that show
  whatever the city's stock: the H1 ("Find Your Dream Home in Pune"), Why Draazy, the owner CTA, the
  footer's Explore links (`/locality`, `/blog`, `/help`, services, listings) and the 5-question FAQ from
  `home.json`, with FAQPage JSON-LD. The stock-dependent hero line, rails and stats are left out.
- [x] **1.6 Real 404s for unknown paths** (S2). Pages' source (workers-sdk `pages-shared/asset-server/
  handler.ts`, `parseRedirects.ts`) shows: `/* /index.html` is always dropped as a loop, so today's SPA
  fallback came from "no 404.html = SPA mode"; `_redirects` rules match *before* assets, so any other
  `/*` rewrite would serve `/assets/*.js` as HTML; `404` rewrites are unsupported; an `.html` target is
  308'd to its extensionless URL. So `scripts/vite-plugin-spa-fallback.mjs` copies the shell to
  `dist/404.html` and generates `_redirects` from `App.jsx`: one `/route /404 200` rule per route
  (splats also get the bare path), and each prerendered page a self-rewrite ahead of its route's rule, so
  `/locality/<non-guide>` still gets the shell with 200. Static rules are written first: Pages counts
  every rule after the first dynamic one as dynamic and silently drops those past 100 (the build fails
  instead). `public/_redirects` is gone.
  deploy.yml checks the files exist and smoke-tests `/listings`, `/property/smoke`, `/locality/baner` and
  `/locality/smoke-area` for 200, and an unknown path for 404. **PENDING SANDBOX**: the first deploy runs that smoke test. Local `wrangler pages
  dev` is blocked here (`workerd` spawn EPERM).
- [x] **1.7 Sitemap generated, not hand-kept**. `public/sitemap.xml` is an empty `<urlset>`; the route-heads
  plugin adds `/` and every `ROUTE_HEADS` path (no `lastmod`: a build date would be false), and the blog,
  locality and help plugins add theirs (90 URLs). `changefreq`/`priority` dropped: Google ignores them.
  **Superseded in phase 2:** two `Sitemap:` lines in `robots.txt` (`/sitemaps/properties.xml`,
  `/sitemaps/societies.xml`) do the job of an index without a second generator.

## Phase 2 — Dynamic pages at the edge (Pages Functions + backend)

Decisions (user, this phase): the edge serves **head + a readable body** (H1, price, facts, description,
amenities) so AI crawlers that don't run JS can read the page; sold/rented/paused listings keep the
status page with similar homes, **noindex and out of the sitemap** — no 410, no migration.
**PENDING SANDBOX** for the whole phase (local `workerd` is blocked): the 301, security headers on
Function responses, HEAD, the `/404` asset fetch, and both sitemaps against the real API.

- [x] **2.1 SEO read model** — the existing public reads are enough (`GET /properties/{id}` takes a UUID or
  slug, 404s unknown/pending/rejected/archived; `GET /societies/{slug}` returns a merged slug's survivor;
  paged `GET /properties` and `GET /societies?hasListings=true`). No backend change. No `updatedAt` on the
  wire, so sitemap `lastmod` is `createdAt`.
- [x] **2.2 `functions/property/[id].js`** — logic in `frontend/edge/seo-pages.mjs` (self-check
  `node edge/seo-pages.test.mjs`). String injection into the `404.html` shell rather than `HTMLRewriter`
  (testable in Node). `RealEstateListing` + `Offer` INR (LeaseOut/Sell, MONTH for rent, InStock/SoldOut),
  `mainEntity` Apartment/House/SingleFamilyResidence/Place, geo rounded to 3 dp, BreadcrumbList,
  `VideoObject` for an https reel, `og:image` = listing photo. API 404 → real 404 noindex; API down →
  plain shell 200. `_headers` is not applied to Functions, so `SECURITY_HEADERS` is a copy that
  `check:csp` asserts equal. No edge HTML cache — `PublicReadCacheFilter` already caches 30 s.
- [x] **2.3 `functions/society/[slug].js`** — `ApartmentComplex` + breadcrumbs; merged slug 301s; thin
  society noindex. `AggregateRating` skipped until real reviews exist (needs `/brief`).
- [x] **2.4 Sitemaps** — `functions/sitemaps/[name].js` serves `properties.xml` (approved, not closed)
  and `societies.xml` (with listings) from the API, cached 1 h, 503 + `Retry-After` on API failure.
  Cap 5,000 URLs (50 pages × 100).
- [x] **2.5 Rented/sold policy** — see decisions above: noindex + dropped from the sitemap, status page stays.
- [x] **2.6 Descriptive property URLs** (D5) — `src/lib/listingSeo.js` `propertyPath`: UUID listings get
  `/property/<bhk>-<type>-for-<rent|sale>-<locality>-<uuid>`; a hand-set slug (demo seed only) stays the
  URL; mock ids stay bare. Edge 301s any other path to the canonical. `propertyKey` reads the trailing
  UUID for `useProperty` and the contact gate. Cards, Featured, Recently viewed, Similar, map panel and
  owner page link the canonical; other in-app links keep the bare id and rely on the 301.
- [x] **2.7 Per-page OG images** — listing photo (2.2); blog and locality cards are drawn by
  `scripts/gen-og-cards.mjs` into `public/og/{blog,locality}/<slug>.jpg` (committed output: the Pages build
  has no Playwright; rerun it after adding a post — it draws only missing cards, `--force` redraws).

## Phase 3 — New pages (🖥️ every one — needs D7 per page)

- [x] **3.1 `/about`** (S14, A4) — `TrustPage.jsx` + `data/trustPages.js`; AboutPage JSON-LD → Organization
  `@id`; "Built in Pune by the Draazy team" (D8); links `/compare/nobroker`. Footer link.
- [x] **3.2 `/how-verification-works`** (S14, moat) — 6-question FAQ + FAQPage JSON-LD. Copy follows the
  code: Assured = staff review of every listing + masked numbers + report → re-verify; owner KYC is the
  optional "ID verified" badge (not a gate). Linked from the home Assured chip, the property Assured block
  ("How we verify"), the report-a-listing help article and `rental-scams-pune`.
- [x] **3.3 Free tools** — `/tools` hub (ItemList) + the four tools (WebApplication + FAQPage), formulas in
  `lib/toolCalc.js` (shared with `LegalCostCalc`/`useRentAgreement`); footer "Free tools". Stamp duty shows
  PMC/PCMC 7% only (no citable source for the women's concession or other areas).
- [x] **3.4 Flatmate locality pages** — `/flatmates/<locality>`, `/flatmates/women-only-pune` (edge
  `functions/flatmates/[slug].js` + SPA `FlatmateLanding.jsx`); edge body shows title, budget, room type,
  seats only. The feed has no strict women-only filter, so that page filters one 50-post page. Edge
  PENDING SANDBOX.
- [x] **3.5 Programmatic rent/buy landing pages** (S16) — `/rent|buy/<pune|locality>[/<n>-bhk]` via
  `lib/landingPages.js` + `edge/landing-pages.mjs` + `functions/{rent,buy}/[[path]].js` + SPA
  `RentBuyLanding.jsx`; D18 thresholds → noindex and out of `sitemaps/landing.xml`. BHK counts come from
  the first 100 rows per place/deal (no count API). Edge PENDING SANDBOX.
- [x] **3.6 `/compare/nobroker`** (G4, D17) — 8 rows, every NoBroker cell links its own page, facts as of
  October 2026, ex-GST; WebPage + FAQPage only (no rating/product markup).
- [x] **3.7 Pune Rent Report** (G2, D16) — `blog/pune-rent-report-2026.md` + `public/data/pune-rent-report-2026-q4.csv`
  (Magicbricks published ranges, as of 9 Oct 2026); Dataset JSON-LD + visible CSV link.
- [x] **3.8 Locality comparison posts** — `baner-vs-wakad`, `kharadi-vs-hadapsar` (`kharadi-vs-viman-nagar`
  already existed).

## Phase 4 — Content upgrades (Markdown = not UI; byline/date rendering = 🖥️)

- [x] **4.1 Answer-first + Key facts** (G1) — all 12 posts and 12 guides (guides' "At a glance" merged in).
- [x] **4.2 Sources section** — every post and guide, dated October 2026.
- [x] **4.3 Author in JSON-LD** (S15, D10) — "Draazy Editorial Team" Organization (url `/about`) on every
  post and guide (guides gained an Article node); visible byline "By Draazy Editorial Team · Updated <date>";
  frontmatter `updated`. No reviewer.
- [x] **4.4 Fact review** — skipped per D14. Agents corrected what they could source (Line 3: 17 of 23
  stations cleared, not open as of 9 Oct 2026; Balewadi; Index II; police drives). Re-check Line 3 and the
  Hinjawadi PCMC merger before launch day.
- [x] **4.5 New cluster posts** — 16 posts: `hra-rent-receipts-pune`, `notice-period-lock-in-rent-agreement`,
  `society-noc-for-tenants-pune`, `maintenance-charges-who-pays-pune`, `home-loan-eligibility-pune`,
  `carpet-vs-built-up-area`, `oc-cc-check-pune`, `resale-flat-documents-pune`, `tenant-screening-owners-pune`,
  `rental-income-tax-owners`, `leave-and-licence-vs-lease`, `flatmate-agreement-pune`,
  `split-rent-and-bills-flatmates`, `women-only-flatshare-safety-pune`, `moving-checklist-pune`,
  `packers-movers-quotes-pune` (31 posts total, each with an OG card).
- [x] **4.6 Rent-range tables in each locality guide** — Magicbricks published ranges with source and as-of
  row (D16); Aundh, Balewadi, Koregaon Park 1 BHK say "Not enough published data".

## Phase 5 — Internal linking (🖥️ — ask)

- [~] **5.1** Locality guide → "Flats for rent in X" / "Property for sale in X" (`/rent|buy/<slug>`) done
  in the app and the prerender. The per-guide **societies list** is not built: it needs the API at build
  time; the rent/buy landing pages list the area's homes instead. Revisit after launch if wanted.
- [x] **5.2** Property page → "Know <Locality>" card (guide + up to 3 posts via `virtual:blog-index`); the
  edge property page links the guide too.
- [x] **5.3** Home → guide chips + 3 newest posts (`ExploreStrips`, lazy, Pune only) after the FAQ.
- [x] **5.4** One `Breadcrumbs.jsx` on property (Home › Rent/Buy › Locality › …, now visible on phones),
  society and the 6 service pages; service pages also emit BreadcrumbList JSON-LD (route-heads).

## Phase 6 — Messaging (🖥️ copy — needs D6)

- [x] **6.1** Home title "Draazy: Broker-free properties for rent & sale in Pune" (D6) + privacy-first
  description (`routeHeads.js`, `index.html`).
- [x] **6.2** Hero line "{city} properties from real owners. Your number stays private."; chips: private
  number, real owners, zero brokerage, Draazy Assured ("Loans, legal & movers" chip dropped to keep four).
- [x] **6.3** Define "Draazy Assured" on a page or drop the term. **Answer 2026-10-09: define it** on
  `/how-verification-works` (see 3.2); the home chip links there; `property.assuredVerified` "Verified
  owner" → "Reviewed by our team" (it showed on every listing regardless of KYC).
- [x] **6.4** One canonical description (153 chars) in manifest, meta, OG/Twitter, Organization JSON-LD,
  `llms.txt`, footer and `/about`; social bios in `tasks/seo/brand-copy.md`. D8: "Draazy Technologies"
  in Terms/Privacy/Refund/settings, no address, officers by role (grievance@draazy.com), support hours
  "9 AM – 8 PM, Mon–Sat" everywhere.
- [x] **6.5** Claims the help centre contradicts or nothing backs (2026-10-09, all user-approved). Sign-in:
  blurb drops "Every listing is RERA-checked", the chip reads "Private number", the no-stock stats are the
  D1 launch facts; Sign-up "RERA-compliant" became "Private by default". Services: 1.4 removed "25+ banks",
  "lowest rate", "10-year warranty", "45-day move-in", "48 hours", "verified owners" and customer ratings;
  the stat strips now show checkable facts (₹0 advisory fee, free eligibility check, 24-hr callback, 7%
  stamp duty, free survey, all-in quotes, itemised quote, agreed handover, written warranty terms, fixed
  valuation fee) with keys renamed to match; partner claims softened ("GST-registered movers", "qualified
  valuer", "one point of contact"; no IBBI, bank-panel or court-acceptance claims). Stamp duty is 7% in
  PMC/PCMC everywhere (legal FAQ, timeline, `LegalCostCalc`; spec updated). Home FAQ `a1` drops "verified".
  Left alone: Terms and Privacy "verified partners" (legal documents, review with counsel).

## Phase 7 — Off-site, AI search and measurement (mostly USER)

- [~] **7.1** `sameAs` = Facebook page, Instagram, X, YouTube (tracking params stripped, footer matches).
  **USER:** LinkedIn company page URL → add to `sameAs` + footer (one line each).
- [x] **7.2 USER** Google Business Profile (only if there is a real address). **Skipped 2026-10-09:** no
  public address (D8). Revisit if Draazy gets an office.
- [ ] **7.3 USER** AI referral tracking — PostHog insight on `$referrer` domains (chatgpt.com, perplexity.ai,
  copilot.microsoft.com, gemini.google.com, claude.ai). Dashboard only; steps in `seo/USER-CHECKLIST.md`.
- [x] **7.4** Monthly AI prompt panel — 40 prompts + log tables in `tasks/seo/ai-prompt-panel.md`. **USER**
  runs it monthly.
- [x] **7.5** Drafts ready: `tasks/seo/reddit-plan.md`, `quora-answers.md`, `youtube-shorts.md`. **USER**
  posts (read each subreddit's rules first; several suggested subs could not be confirmed to exist).
- [x] **7.6** `tasks/seo/outreach.md` (media routes, listicles, templates). **USER** sends.

## Phase 8 — Performance and later

- [ ] **8.1** Core Web Vitals baseline after launch (PageSpeed + CrUX), fix the worst mobile LCP/INP (S10).
- [ ] **8.2** Marathi pages for the top guides + `hreflang` (then 0.7 `lang`).
- [ ] **8.3** Review this plan against Search Console data at day 30/60/90; re-rank phases 3–5.

---

## Verification per slice (no full e2e)

- Plugin self-tests: `node scripts/<plugin>.test.mjs`.
- Build: `npx vite build --outDir <scratch> --emptyOutDir` and inspect the emitted files; delete the
  scratch dir after.
- e2e: only the slice's spec(s), `e2e\run-fast.ps1 -Spec tests/platform/seo/<file>.spec.js`.
  New specs live in `e2e/tests/platform/seo/`; each gets an `e2e/COVERAGE.md` row.
- Edge slices (phase 2) also need a sandbox `curl -I` / view-source check — note it as PENDING
  SANDBOX in `tasks/todo.md` until done.

## Log (one line per finished slice)

- 2026-10-09 — 0.1–0.6: shell JSON-LD, robots hardening, sandbox noindex (`vite.config.js`
  `noindexOffProductionPlugin`), noindex headers, sitemap 19 static URLs, `llms.txt`. Scratch builds
  (default + sandbox `SITE_URL`) inspected; `platform/seo/site-signals`, blog, locality-intel specs green.
  0.4 PENDING SANDBOX `curl -I`.
- 2026-10-09 — 0.8 (D1): launch-fact `STATS`; testimonials deleted on home, Sign-in and Services. Specs
  home-counts, services-hub, auth/improvements, desktop-noleak-guardrails, mobile/home-featured-first green.
  Review follow-ups: "Why Draazy" stat strip gated to launched cities; `localityGuides` drift guard in
  `scripts/vite-plugin-locality-guides.test.mjs`.
- 2026-10-09 — 0.9 (D2): `og-image.jpg` brand card + `og:image` size/alt; `site-signals` asserts it serves
  as `image/jpeg`.
- 2026-10-09 — D3 allow all (0.10 needs no robots change), D4 full content. 1.6 real 404s via generated
  `_redirects` + `404.html`; the 1.1 design was revised because a `/*` rewrite would break assets.
- 2026-10-09 — 1.2: 18 head-only route pages + Service/WebApplication JSON-LD; `site-signals` checks
  title/canonical on load, in-app nav and restore. Entry bundle 378.1/385 KB.
- 2026-10-09 — 1.3: 45 full-content help pages (Article/BreadcrumbList); help head via `usePageHead`;
  `help-urls` checks in-app title/description/canonical swap and restore. FAQPage deferred.
- 2026-10-09 — 1.4: service pages prerendered with full copy + FAQPage; unbacked service claims softened
  (user-approved copy change). Specs service-landings, services-hub, interior-lead, loans-team and
  content-budget: 25/25 passed.
- 2026-10-09 — 1.1, 1.5, 1.7: home prerendered into `index.html` (closeBundle) with canonical + FAQPage, SW
  fallback moved to `404.html`, sitemap generated (90 URLs). Specs site-signals, home-counts, home-payload,
  pwa, content-budget, home-taps, home-featured-first: 25/25 passed. Phase 1 complete.
- 2026-10-09 — Phase 2 (2.1–2.6; 2.7 partial): edge property/society pages, dynamic sitemaps, descriptive
  property URLs. New spec `platform/seo/listing-urls`; 17 specs reaching the change: 68/69 passed. The one
  failure, `verify-payoff` "born unverified" (`POST /me/listings` no longer returns `ownerVerified`), is an
  API-only test hit by another session's uncommitted backend work, not this slice.
- 2026-10-09 — Review fix: sitemap cache keyed on the path (a query string no longer forces a 50-page API
  crawl). Found while auditing deploy: Functions skip `_headers`, so the sandbox `X-Robots-Tag: noindex`
  is now set by host in `edge/seo-pages.mjs` `headersFor` (self-test covers both hosts). All open
  decisions answered (D6–D15); user tasks moved to [seo/USER-CHECKLIST.md](seo/USER-CHECKLIST.md).
- 2026-10-09 — Phases 3–7 built in one run by 11 parallel slices, then integrated: 2.7, 3.1–3.8, 4.1–4.6,
  5.2–5.4 (5.1 partial: no build-time societies list), 6.1–6.4, 7.1 (LinkedIn pending), 7.4–7.6 drafts.
  31 posts, 12 upgraded guides, rent report + CSV, 5 tool pages, 2 trust pages, compare page, rent/buy and
  flatmate landing pages + `landing.xml`. Checks: routes/i18n/csp/cycle, all plugin + edge self-tests,
  content link check (every internal link resolves), scratch build (117 sitemap URLs, bundle 381.0/385 KB).
  e2e: 22 touched specs (128 tests) + reruns green after spec fixes — page JSON-LD is build-time only, so
  those asserts moved to `vite-plugin-route-heads.test.mjs`; flatmates has no h1; tool CTAs include
  `/listings?deal=buy`. Review (opus) fixes: edge flatmate rooms carrying `seatsTotal` were rendered as
  groups (wrong link, no price); `TrustPage` takes its key from the route (case-insensitive match crashed).
  Service pages gained BreadcrumbList JSON-LD. PENDING SANDBOX: landing/flatmate Functions, 301s,
  `landing.xml`, headers.
