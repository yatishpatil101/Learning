# Owner checklist

Things code can't close: secrets, deploy steps, real-device checks, human fact-checks. Tick and delete.

## Secrets and deploy
- [ ] `draazy-sandbox-origin-shared-secret` + Pages `ORIGIN_SHARED_SECRET` (same value), or the revision won't start
- [ ] Deploy `both`, then `curl` a direct non-health route: expect 403
- [ ] Widen `INTERNAL_PROXIES` per `docs/DEPLOY.md` §4 with a real `X-Forwarded-For`
- [ ] Cloudflare WAF managed rules + one `/api/auth/*` rate-limit rule (Bot Fight Mode off)
- [ ] Cloudflare Cache Rule for extensionless photo originals; check the R2 cache header on a real upload
- [ ] Anonymous `/api/flags` on the Pages host should not reach Cloud Run
- [ ] Cashfree: real `TEST…`/`cfsk_…` in `draazy-sandbox-cashfree-app-id`/`-secret-key`; one RA payment + one subscription with the console open (order, modal, callback, signature, settlement, CSP `form-action`)
- [ ] R2: startup line, one identity submit, one listing photo, bucket `Access-Control-Allow-Origin`
- [ ] `draazy-sandbox-google-places-server-key`; read Google's lat/lng caching terms
- [ ] `ZEPTOMAIL_API_KEY` + `ZEPTOMAIL_ENABLED=true`
- [ ] VAPID key pair (`npx web-push generate-vapid-keys`): secrets `draazy-sandbox-push-vapid-private-key` / `-public-key`, and repo var `VITE_VAPID_PUBLIC_KEY` (same public key) — web push is wired (B41), deploy fails without the secrets
- [ ] WhatsApp daily digest template: submit to Meta as `UTILITY` (body in `docs/DEPLOY.md` §3), then set `WHATSAPP_DIGEST_TEMPLATE_NAME` — until approved no digest is sent
- [ ] Rotate `backend/.env.local` secrets if in doubt (surfaced 2026-08-09)
- [ ] Optional: `ANTHROPIC_API_KEY` or `GOOGLE_API_KEY` for graphify community labels

## Real phones
- [ ] Liveness on a webcam, Android and iPhone Safari; camera denied; backgrounded capture
- [ ] `/reels`: landscape insets, chip `:active`, 44px chips at 360×640, snap with `content-visibility`
- [ ] `/list-property`: tile lift, `.lp-meter` top, press feedback; photo drag-reorder long-press (iOS)
- [ ] `/listings` map sheet: `86dvh`, pinch-zoom, grabber, pull-to-refresh; Android Back on the filter sheet
- [ ] `/flatmates`: locality popup, drawer insets on a notch; group chat; detail tap/safe-area feel
- [ ] Scroll lock (older iOS): Compare picker, `DashboardReviewModal`, society stack, `AdminSocieties` dialogs; home-indicator clearance
- [ ] Select/MultiSelect with the iOS Safari and Android keyboards

## Content and ops
- [ ] Fact-check the 12 blog posts and 12 locality guides; re-check Metro Line 3 and the Hinjawadi PCMC merger before deploy
- [ ] Seed production FAQs (they answer `[]`): paste the 4 corrected FAQs from the Help audit; the first 6 by category also show on Home, the built-in five until then
- [ ] Lawyer glance at the 2026-10-10 legal edits: Terms §7 + Refund §2.2 (no auto-renewal), Refund §6 (no wallet credits), Privacy §1.3/§4/§7 (no Google login, erasure is a reviewed request)
- [ ] Confirm or delete Privacy §5 security claims (TLS 1.3, AES-256, pen-testing, SOC 2 Type II); Refund's 7-day cooling-off and annual pro-rata clauses have no backend flow, so support refunds them by hand
- [ ] Confirm rent-agreement SLA targets with ops
- [ ] Ops: act on legacy pending flatless flatmate posts
