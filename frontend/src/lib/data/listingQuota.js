/** Feeds the wizard's paywall only, never the gate, so it fails open. */
import { getEntitlements } from '../../services/entitlementService.js';
import { listingSlots } from '../../services/propertyService.js';

/** `{ used, allowance, canPost }`; an unknown `allowance` is `null` and `canPost` then stays `true`. */
function standing(listings) {
  const allowance = Number.isFinite(listings?.allowance) ? listings.allowance : null;
  const used = Number(listings?.used) || 0;
  return { used, allowance, canPost: allowance == null || used < allowance };
}

/** For a screen the dashboard aggregate already primed `/me/entitlements` for. */
export const loadListingQuota = () => getEntitlements().then((e) => standing(e?.listings), () => standing(null));

/** The two numbers alone, for the wizard, which has no entitlements read to share. */
export const loadWizardQuota = () => listingSlots().then(standing, () => standing(null));
