/** Includes `geo`, which the server stores like other settings though the contract omits it. */
import { createProvider } from './config.js';

const provider = createProvider('settings');

export const getSettings = async () => (await provider()).getSettings();

export const updateSettings = async (patch) => (await provider()).updateSettings(patch);

/** The console's navigation gate is `GET /admin/permission-catalogue` plus the atoms the server returns on
 * `/auth/me`. */
export const getAppFlags = async () => (await provider()).getAppFlags();

/** It is not part of `getAppFlags()` because that endpoint's contract is map-of-boolean and drops everything else, so
 * it cannot carry a price list without disagreeing with its own schema. */
export const getMovePack = async () => (await provider()).getMovePack();

/** **A fourth public route.** Live this reads `GET /geo`, for the reason the flags and the Move-in Pack each read
 * their own: the block gates what a *logged-out visitor* sees. */
export const getGeo = async () => (await provider()).getGeo();

/** What a healthy install charges, and the answer when the server cannot be reached. */
export const PRICING_DEFAULTS = Object.freeze({
  ownerPlanYearly: 999,
  ownerProYearly: 2499,
  rentAgreementPlatform: 500,
  seekerPlusTopup: 199,
  featuredListing: 999,
  gstPercent: 18,
});

/** **A fifth public route.** This reads `GET /pricing`, for the reason each of the others reads its own. */
export const getPricing = async () => (await provider()).getPricing();

export const getListingPolicy = async () => (await provider()).getListingPolicy();
