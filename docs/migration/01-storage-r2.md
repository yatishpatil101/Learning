# 01 — Storage strategy (photos & documents): Cloudflare R2

**Headline:** the R2 provider is **already fully built**. This is a *configuration* task, not a
build task. ADR-013 chose Cloudflare R2; `R2FileStorage` implements the complete upload → store →
serve flow for both buckets. Turning it on is one flag plus six properties.

## What already exists (do not rebuild)

| Class | Role |
|-------|------|
| `provider/FileStorage.java` | The seam. `store` / `signedUploadUrl` / `signedDownloadUrl` (private) + `storePublic` (public). |
| `provider/storage/R2FileStorage.java` | **Complete** R2 impl — S3 SDK v2, path-style, region `auto`, 15-min presigned PUT/GET, separate public+private buckets. Gated on `punenest.providers.storage.enabled=true`. |
| `provider/storage/R2Properties.java` | The six config values it needs. |
| `provider/storage/DevObjectStore.java` | Dev fallback — writes bytes to a local dir, serves them back via HMAC-signed, expiring `/dev/storage/...` URLs (D120 fix). Active when the flag is **off**. |
| `provider/FileStorage.java` → `MockFileStorage` | Dev bean that delegates to `DevObjectStore`. Flag off. |
| `provider/FileStorage.java` → `ObjectStoreFileStorage` | Non-dev safe default — **throws** until real storage is configured. |

Bean selection is by `@ConditionalOnProperty`:

- `punenest.providers.storage.enabled=true` → **`R2FileStorage`** (real R2).
- flag off, `dev` profile → **`MockFileStorage` + `DevObjectStore`** (local disk, resolvable URLs).
- flag off, non-dev → **`ObjectStoreFileStorage`** (throws — deliberately, so an unconfigured
  prod cannot silently drop uploads).

## The public/private boundary (keep it)

Two buckets, routed at the vendor so a document can never come back as an unsigned URL:

- **Photos → public bucket** via `storePublic(key, bytes, type)` → returns a **permanent,
  world-readable CDN URL** persisted directly on the listing row. No signature, no expiry.
- **Documents / KYC → private bucket** via `store(...)` + `signedDownloadUrl(key)` → a fresh
  **15-minute signed GET** every read. World-unreadable at rest.

## What "permanently stored and seeded" means here — two distinct kinds of asset

The owner's requirement splits cleanly:

1. **Seed/demo photos & localities** — these are **already external URLs** in the seed
   (Unsplash `images.unsplash.com/...` in the `photos` JSONB + `hero_image`; localities/societies
   from `R__seed_reference_data.sql`). They **display live for free** the moment the frontend hits
   the API — no storage work needed. Decision in [02-seed-and-fixtures.md](02-seed-and-fixtures.md):
   keep them as stable URLs (simplest, zero-cost) **or** optionally re-host into the R2 public
   bucket for offline-proof demos. Recommend **keep-URL** unless offline demos are required.
2. **User-uploaded photos & documents** — new listing photos, KYC papers, agreements. These are
   the assets that need real storage, and R2 already handles them. This is the actual "storage
   strategy" deliverable.

## Configuration to turn R2 on (Phase 2)

Put real values in a **git-ignored** `backend/.env.local` (or profile props); never commit keys.

```properties
punenest.providers.storage.enabled=true
punenest.providers.storage.endpoint=https://<accountid>.r2.cloudflarestorage.com
punenest.providers.storage.access-key-id=<r2-access-key-id>
punenest.providers.storage.secret-access-key=<r2-secret>
punenest.providers.storage.private-bucket=punenest-docs-sandbox
punenest.providers.storage.public-bucket=punenest-photos-sandbox
punenest.providers.storage.public-base-url=https://<public-bucket-custom-domain>
```

`R2FileStorage` **refuses to start** if any of the six is blank — by design. Verify the exact
property names against `R2Properties.java` before wiring (do not guess the prefix casing).

### Bucket / key scheme

- Public (photos): `listings/{propertyId}/{uuid}.{ext}` → served at `public-base-url/<key>`.
- Private (docs): `personal/{ownerId}/{uuid}` and per-property doc keys (as the document endpoints
  already mint them). Confirm the exact key shape from the document/photo controllers before
  changing anything — the keys are already persisted on rows.

## Dev-without-keys stays working

A developer with **no** R2 keys keeps the flag **off** and gets `DevObjectStore`: uploads write to
`${java.io.tmpdir}/punenest-storage`, downloads resolve via signed `/dev/storage/...` URLs that
expire in 30 min and die on restart. This is the correct local default; only the person exercising
real R2 flips the flag.

## Migration checklist

- [x] Provision an R2 sandbox: two buckets (public + private), an API token, a public base URL
      (custom domain or `r2.dev`) for the public bucket.
      → `punenest-sandbox-public` / `punenest-sandbox-private`, served at a `pub-….r2.dev` base URL.
- [x] Read `R2Properties.java` and set the six properties in `backend/.env.local` (git-ignored).
      The prefix is `punenest.providers.storage`; `application.properties` already binds all six
      from `${R2_*}` env vars with blank defaults, so `.env.local` sets the `R2_*` names and
      nothing in the property files needed editing.
- [x] Confirm `backend/.env.local` is in `.gitignore`. → matched by `.gitignore:26` (`.env.*`).
- [x] Flip `punenest.providers.storage.enabled=true`; boot; confirm the log line
      `R2 object storage enabled (private bucket '…', public bucket '…')`.
      Confirmed on a full Spring context boot with `STORAGE_ENABLED=true`.
- [x] Exercise `R2FileStorageLiveTest` against the sandbox (it already exists). → 2/2 green.
- [x] Upload a listing photo end-to-end; confirm the CDN URL is persisted and renders in the UI.
      `MePhotosLiveTest` green: a real POST through security → controller → `storePublic` puts the
      bytes in the public bucket and returns the CDN URL for a server-minted, owner-scoped key.
      **Browser rendering is not verifiable on this machine** — the corporate proxy refuses TLS to
      `*.r2.dev` (`Could not create SSL/TLS secure channel`). That is an environment limit, not a
      code one, and production serves photos from a custom domain rather than `r2.dev`; re-verify
      rendering off-network or once the custom domain is attached.
- [x] Upload a document; confirm the signed GET opens and a stale/copied URL is refused.
      New `MePersonalDocumentsLiveTest` covers the private half through the endpoint chain: the KYC
      file lands under `personal/{ownerId}/{uuid}` in the **private** bucket (asserted by listing
      the prefix, not by trusting the URL), the signed GET returns the exact bytes, and the same
      URL with its signature stripped is refused. *Stale* is not asserted: the presign window is a
      hard-coded 15 minutes, so a genuinely expired URL cannot be produced in a test without making
      the window configurable to prove something about a value production never uses. The property
      that protects the documents is that authority lives in the signature and the object is not
      world-readable at rest — that is what the unsigned leg tests.
- [x] Decide seed-photo hosting (keep-URL vs re-host) in [02](02-seed-and-fixtures.md).
      **Keep-URL**, already recorded there. R2 changes nothing about it: seed photos are external
      Unsplash URLs on the row, never storage keys, so `storePublic` is not on their path. Re-hosting
      buys only an offline demo, and this machine's proxy blocks `r2.dev` while it allows Unsplash —
      so re-hosting would make the seed *less* likely to render here, not more.
- [x] Leave the flag **off** in the committed dev config so no-keys devs still work.
      Nothing committed changed: `STORAGE_ENABLED` defaults to `false` in `application.properties`
      and the live runs above set it only in the shell environment.

## Risks

- ~~**Signed-URL preview in dev today**~~ — checked. `DEV_STORAGE_STUB` in
  [openDoc.js](../../frontend/src/lib/openDoc.js) is `/^https?:\/\/mock\.storage\.local\b/i`,
  anchored to the mock host alone, so a real `…r2.cloudflarestorage.com` presigned URL is openable.
  No change needed.
- ~~**CORS on the public bucket**~~ — not applicable to the current design. No browser ever talks to
  R2 directly: uploads are multipart to our own API (`signedUploadUrl` has **no frontend caller**),
  photos are `<img src>` (not a CORS-governed fetch, no `crossorigin` attribute) and documents open
  in a new tab. CORS becomes relevant only if a direct browser→R2 PUT is ever introduced.
- ~~**Key collisions**~~ — checked. Every key mints its own `UUID.randomUUID()` per object
  (`personal/{ownerId}/{uuid}`, `photos/{ownerId}/{uuid}`), so the uuid is per-object by
  construction, not per-property.

