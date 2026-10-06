import { get, put } from '../../http.js';
import { bootstrapSection } from './bootstrap.js';
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
  const flags = await bootstrapSection('flags');
  return flags && typeof flags === 'object' ? flags : {};
}

export async function getMovePack() {
  const cfg = await bootstrapSection('movePack');
  if (!cfg || typeof cfg !== 'object') return { enabled: false, items: {} };
  return {
    enabled: cfg.enabled === true,
    items: cfg.items && typeof cfg.items === 'object' ? cfg.items : {},
  };
}

export async function getGeo() {
  const geo = await bootstrapSection('geo');
  return geo && typeof geo === 'object' ? geo : {};
}

export async function getPricing() {
  const raw = await bootstrapSection('pricing');
  if (!raw || typeof raw !== 'object') return { ...PRICING_DEFAULTS };
  const out = { ...PRICING_DEFAULTS };
  for (const key of Object.keys(PRICING_DEFAULTS)) {
    if (Number.isFinite(raw[key])) out[key] = raw[key];
  }
  return out;
}

/** The `listingPolicy` section of `GET /bootstrap` (`common/settings/ListingPolicyController.java`). */
export async function getListingPolicy() {
  const raw = await bootstrapSection('listingPolicy');
  const n = raw?.maxPhotos;
  return { maxPhotos: Number.isInteger(n) && n > 0 && n <= MAX_PHOTOS_CEILING ? n : DEFAULT_MAX_PHOTOS };
}
