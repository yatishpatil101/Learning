# Your SEO / AI-search checklist

Only you can do these: they need your dashboards or accounts. Tick them here; I check the plan off
from this file. Plan: [../seo-aio-geo-plan.md](../seo-aio-geo-plan.md).

## Now

- [ ] **LinkedIn company page** (7.1). Create one at linkedin.com/company/setup/new (the footer links a
  personal `/in/` profile, which search engines don't read as the company). Send me the URL; I update the
  footer and the company JSON-LD.
- [ ] **PostHog — AI referrals insight** (7.3).
  1. Product analytics → New insight → Trends. Event: `$pageview`.
  2. Filter: `Referring domain` matches regex
     `chatgpt\.com|chat\.openai\.com|perplexity\.ai|copilot\.microsoft\.com|gemini\.google\.com|claude\.ai`.
  3. Breakdown by `Referring domain`. Weekly. Save as "AI referrals" on a dashboard named "SEO & AI".

## When the sandbox is deployed

- [ ] **Tell me.** I check the edge pages myself with curl: a property and a society page, the 301 from a
  bare id, the three sitemaps (`properties`, `societies`, `landing`), `/rent/baner`, `/buy/pune`,
  `/rent/baner/2-bhk`, `/flatmates/baner`, `/flatmates/women-only-pune`, the security headers, the sandbox
  `X-Robots-Tag: noindex`, and a real 404.
- [ ] **Click through the new pages on your phone** (all UI you approved): `/about`,
  `/how-verification-works`, `/tools` and the four tools, `/compare/nobroker`, the home hero chips and the
  new guide/post strips under the FAQ, a property page (breadcrumb + "Know <Locality>" card), and a blog
  post (byline, Key facts table).

## Before launch day

- [ ] **Re-check two facts** the posts date to 9 Oct 2026: whether Metro Line 3 has opened (Hinjawadi,
  Balewadi, Baner guides; `hinjawadi-wakad-baner-rent`) and whether Hinjawadi has merged into PCMC. Tell
  me what changed; I update the text.
- [ ] **Skim `/compare/nobroker`** against nobroker.in once; their prices change. The page says "as of
  October 2026".

## Launch day (production live on draazy.com)

- [ ] **Cloudflare — AI Crawl Control** (0.11). Zone `draazy.com`:
  1. AI Crawl Control → Crawlers: every search/answer bot is **Allow** — OAI-SearchBot, ChatGPT-User,
     PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User, Bingbot, Applebot, Googlebot. You
     chose to allow the training bots too (GPTBot, ClaudeBot, Google-Extended, CCBot).
  2. Security → Settings → Bot traffic: **Block AI bots** is off.
  3. Same page: the Cloudflare-managed robots.txt is **off**, so ours is served unchanged.
  4. Check: `curl -A "OAI-SearchBot" -I https://draazy.com/blog` returns 200, not 403.
- [ ] **Google Search Console** (0.12).
  1. Add property → **Domain** → `draazy.com` → copy the TXT record → Cloudflare DNS → add TXT → Verify.
  2. Sitemaps → submit `sitemap.xml`, `sitemaps/properties.xml`, `sitemaps/societies.xml`,
     `sitemaps/landing.xml`.
  3. URL inspection → Request indexing for `/`, `/blog`, `/locality`, one guide, one blog post.
- [ ] **Bing Webmaster Tools** (0.12). Sign in → Import from Google Search Console (copies the site and
  sitemaps). Bing feeds Copilot and ChatGPT search, so do not skip it.
- [ ] **Cloudflare Crawler Hints** (0.12). Caching → Configuration → Crawler Hints **on** (pings Bing and
  Yandex through IndexNow when pages change).

## Ongoing

- [ ] **Post the off-site drafts** (7.5, 7.6) from `tasks/seo/`: `reddit-plan.md` (read each subreddit's
  rules tab first), `quora-answers.md`, `youtube-shorts.md`, `outreach.md`.
- [ ] **Monthly AI prompt panel** (7.4): run the 40 prompts in `ai-prompt-panel.md` (~30 min) and fill
  the log table.
- [ ] **Day 30 / 60 / 90** (8.3): share Search Console's Performance → Pages and Queries export; I
  re-rank the remaining work and pick the Marathi guides (8.2).
