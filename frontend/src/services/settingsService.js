/** Includes `geo`, which the server stores like other settings though the contract omits it. */
import { createProvider } from './config.js';

const provider = createProvider('settings');

export const getSettings = async () => (await provider()).getSettings();

export const getAdminFlags = async () => (await provider()).getAdminFlags();

export const updateSettings = async (patch) => (await provider()).updateSettings(patch);

/** The console's navigation gate is the atoms the server returns on `/auth/me`. */
export const getAppFlags = async () => (await provider()).getAppFlags();

/** Not part of `getAppFlags()`: the `flags` section is map-of-boolean, so it cannot carry a price list. */
export const getMovePack = async () => (await provider()).getMovePack();

/** The `geo` section of `GET /bootstrap`: the block gates what a *logged-out visitor* sees. */
export const getGeo = async () => (await provider()).getGeo();

/** What a healthy install charges, and the answer when the server cannot be reached. */
export const PRICING_DEFAULTS = Object.freeze({
  ownerPlanYearly: 999,
  ownerProYearly: 2499,
  rentAgreementPlatform: 500,
  seekerPlusTopup: 199,
  gstPercent: 18,
});

/** The `pricing` section of `GET /bootstrap`. */
export const getPricing = async () => (await provider()).getPricing();

export const getListingPolicy = async () => (await provider()).getListingPolicy();
