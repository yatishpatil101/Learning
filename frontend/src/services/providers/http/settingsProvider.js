import { get, put } from '../../http.js';
import { PRICING_DEFAULTS } from '../../settingsService.js';
import { DEFAULT_MAX_PHOTOS, MAX_PHOTOS_CEILING } from '../../../lib/uploads/policy.js';

/** The whole configuration document. */
export async function getSettings() {
  const doc = await get('/admin/settings');
  return doc && typeof doc === 'object' ? doc : {};
}

/** Deep-merge `patch` into the stored document; resolves with the document **as saved**. */
export async function updateSettings(patch) {
  const doc = await put('/admin/settings', patch);
  window.dispatchEvent(new CustomEvent('draazy-settings-change'));
  return doc && typeof doc === 'object' ? doc : {};
}

/** Not a stub and not a missing feature: migration V61 deleted `settings.customRoles`, and `PUT /admin/settings`
 * answers **422** for the key rather than storing it — sending it here would fail the write. */
export async function getCustomRoles() {
  return [];
}

/* App flags affect anonymous visitors, so they publish outside admin-only settings. */
export async function getAppFlags() {
  const flags = await get('/flags');
  return flags && typeof flags === 'object' ? flags : {};
}

/* Move-pack config is public and not boolean-only, so it cannot live under `/flags`. */
export async function getMovePack() {
  const cfg = await get('/move-pack');
  if (!cfg || typeof cfg !== 'object') return { enabled: false, items: {} };
  return {
    enabled: cfg.enabled === true,
    items: cfg.items && typeof cfg.items === 'object' ? cfg.items : {},
  };
}

/* Geo config is public structured data, not boolean flags. */
export async function getGeo() {
  const geo = await get('/geo');
  return geo && typeof geo === 'object' ? geo : {};
}

/* Pricing is public structured data, not boolean flags. */
export async function getPricing() {
  const raw = await get('/pricing');
  if (!raw || typeof raw !== 'object') return { ...PRICING_DEFAULTS };
  const out = { ...PRICING_DEFAULTS };
  for (const key of Object.keys(PRICING_DEFAULTS)) {
    if (Number.isFinite(raw[key])) out[key] = raw[key];
  }
  return out;
}

/** `GET /listing-policy` (schema `ListingPolicy`, `common/settings/ListingPolicyController.java`). */
export async function getListingPolicy() {
  const raw = await get('/listing-policy');
  const n = raw?.maxPhotos;
  return { maxPhotos: Number.isInteger(n) && n > 0 && n <= MAX_PHOTOS_CEILING ? n : DEFAULT_MAX_PHOTOS };
}
